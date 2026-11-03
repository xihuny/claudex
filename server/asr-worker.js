// Streaming speech recognition, in its own process.
//
// Both halves of this are blocking C++ calls: building the recognizer stalls for ~9 s,
// and every decode step costs ~25 ms. Run that on the main server's event loop and each
// spoken word would stutter the PTY streams, so it lives out here and talks over stdio.
//
// Protocol - newline-delimited JSON, both directions:
//   in   {t:"open", id}                 start a stream
//        {t:"audio", id, pcm:"<b64>"}   16 kHz mono Int16 samples
//        {t:"close", id}                flush and drop the stream
//   out  {t:"ready"}                    models loaded, send audio
//        {t:"partial", id, text}        best guess so far for the current segment
//        {t:"final", id, text}          segment ended (silence or flush)
//        {t:"error", message}
import path from "path";
import fs from "fs";
import { createRequire } from "module";
import { PUNCT_DIR, resolveProfile, profilePaths } from "./asr-models.js";
import { applyVocab, vocabSize } from "./asr-vocab.js";

const require = createRequire(import.meta.url);
const THREADS = Number(process.env.ASR_THREADS || 4);

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

const profile = resolveProfile();
let recognizer, punct;
try {
  if (!profile) throw new Error("no speech model installed under SHERPA_DIR");
  const sherpa = require("sherpa-onnx-node");
  const p = profilePaths(profile);
  recognizer = new sherpa.OnlineRecognizer({
    modelConfig: {
      transducer: { encoder: p.encoder, decoder: p.decoder, joiner: p.joiner },
      tokens: p.tokens,
      numThreads: THREADS,
      provider: "cpu",
    },
    featConfig: { sampleRate: 16000, featureDim: 80 },
    // Beam search keeps a few competing hypotheses alive instead of committing to the
    // best token at every step, so a word can still be rescued by the ones after it.
    // Measured on this box: RTF 0.13 -> 0.24, i.e. still four times faster than real
    // time, and the median cost of decoding a 100 ms frame doesn't move.
    decodingMethod: "modified_beam_search",
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,   // silence with nothing decoded yet
    rule2MinTrailingSilence: 1.4,   // pause after speech → commit the segment
    rule3MinUtteranceLength: 25,    // hard cut so one long take still commits
  });
  // Only for models that write ALL CAPS with no punctuation. A model that punctuates
  // itself must skip this: addPunct() needs lowercase input, and lowercasing would
  // destroy every capital the recogniser got right.
  if (!profile.punctuates && fs.existsSync(path.join(PUNCT_DIR, "model.int8.onnx"))) {
    punct = new sherpa.OnlinePunctuation({
      model: {
        cnnBilstm: path.join(PUNCT_DIR, "model.int8.onnx"),
        bpeVocab: path.join(PUNCT_DIR, "bpe.vocab"),
        numThreads: 1,
        provider: "cpu",
      },
    });
  }
  console.error(`[asr] model=${profile.id} punct=${punct ? "model" : profile.punctuates ? "native" : "none"} vocab=${vocabSize()} rules`);
} catch (e) {
  send({ t: "error", message: String((e && e.message) || e) });
  process.exit(1);
}

// Turn a raw hypothesis into something you would actually want in the composer:
// punctuation and casing first, then the project's vocabulary over the top.
const dress = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return "";
  let out = text;
  if (!profile.punctuates) {
    const lower = text.toLowerCase();
    try { out = punct ? punct.addPunct(lower) : lower.charAt(0).toUpperCase() + lower.slice(1); }
    catch { out = lower; }
  }
  return applyVocab(out);
};

const streams = new Map();

function feed(id, pcm) {
  const s = streams.get(id);
  if (!s) return;
  const samples = new Float32Array(pcm.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  s.stream.acceptWaveform({ sampleRate: 16000, samples });
  while (recognizer.isReady(s.stream)) recognizer.decode(s.stream);

  const text = recognizer.getResult(s.stream).text;
  if (recognizer.isEndpoint(s.stream)) {
    // A pause ended the segment: commit it and start the next one clean.
    if (text.trim()) send({ t: "final", id, text: dress(text) });
    recognizer.reset(s.stream);
    s.last = "";
    return;
  }
  if (text !== s.last) { s.last = text; send({ t: "partial", id, text: dress(text) }); }
}

function closeStream(id) {
  const s = streams.get(id);
  if (!s) return;
  streams.delete(id);
  // Half a second of silence pushes the last word out of the encoder's lookahead.
  s.stream.acceptWaveform({ sampleRate: 16000, samples: new Float32Array(8000) });
  s.stream.inputFinished();
  while (recognizer.isReady(s.stream)) recognizer.decode(s.stream);
  const text = recognizer.getResult(s.stream).text;
  send({ t: "final", id, text: text.trim() ? dress(text) : "" });
}

let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    try {
      if (msg.t === "open") streams.set(msg.id, { stream: recognizer.createStream(), last: "" });
      else if (msg.t === "audio") feed(msg.id, Buffer.from(msg.pcm, "base64"));
      else if (msg.t === "close") closeStream(msg.id);
    } catch (e) {
      send({ t: "error", id: msg.id, message: String((e && e.message) || e) });
    }
  }
});

send({ t: "ready" });
