// Throwaway harness: compare streaming recognisers on decode latency, not just accuracy.
//
// Feeds each wav in 100 ms frames - the same cadence the browser sends - and records how
// long the decode of each frame takes. What matters for dictation is the *per-frame*
// cost: as long as it stays well under 100 ms the words keep up with the speaker, and
// the visible delay is the model's own lookahead, not our compute.
//
// Usage: node server/asr-bench.mjs
import path from "path";
import os from "os";
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const sherpa = require("sherpa-onnx-node");
const SHERPA_DIR = process.env.SHERPA_DIR || path.join(os.homedir(), ".local/opt/sherpa");
const D = (...p) => path.join(SHERPA_DIR, ...p);
const THREADS = Number(process.env.ASR_THREADS || 4);

const CONFIGS = [
  {
    name: "zipformer-2023-06-26 int8 greedy (current)",
    dir: "sherpa-onnx-streaming-zipformer-en-2023-06-26",
    transducer: {
      encoder: D("sherpa-onnx-streaming-zipformer-en-2023-06-26", "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx"),
      decoder: D("sherpa-onnx-streaming-zipformer-en-2023-06-26", "decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx"),
      joiner: D("sherpa-onnx-streaming-zipformer-en-2023-06-26", "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx"),
    },
    tokens: D("sherpa-onnx-streaming-zipformer-en-2023-06-26", "tokens.txt"),
    decodingMethod: "greedy_search",
  },
  {
    name: "zipformer-2023-06-26 int8 beam4",
    dir: "sherpa-onnx-streaming-zipformer-en-2023-06-26",
    transducer: {
      encoder: D("sherpa-onnx-streaming-zipformer-en-2023-06-26", "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx"),
      decoder: D("sherpa-onnx-streaming-zipformer-en-2023-06-26", "decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx"),
      joiner: D("sherpa-onnx-streaming-zipformer-en-2023-06-26", "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx"),
    },
    tokens: D("sherpa-onnx-streaming-zipformer-en-2023-06-26", "tokens.txt"),
    decodingMethod: "modified_beam_search",
    maxActivePaths: 4,
  },
  {
    name: "kroko-2025-08-06 beam4",
    dir: "sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06",
    transducer: {
      encoder: D("sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06", "encoder.onnx"),
      decoder: D("sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06", "decoder.onnx"),
      joiner: D("sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06", "joiner.onnx"),
    },
    tokens: D("sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06", "tokens.txt"),
    decodingMethod: "modified_beam_search",
    maxActivePaths: 4,
  },
  {
    name: "nemo-fast-conformer-480ms beam4",
    dir: "sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms",
    transducer: {
      encoder: D("sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms", "encoder.onnx"),
      decoder: D("sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms", "decoder.onnx"),
      joiner: D("sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms", "joiner.onnx"),
    },
    tokens: D("sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms", "tokens.txt"),
    // NeMo's transducer impl in sherpa-onnx only implements greedy search.
    decodingMethod: "greedy_search",
    modelType: "nemo_transducer",
  },
  {
    name: "kroko-2025-08-06 greedy",
    dir: "sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06",
    transducer: {
      encoder: D("sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06", "encoder.onnx"),
      decoder: D("sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06", "decoder.onnx"),
      joiner: D("sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06", "joiner.onnx"),
    },
    tokens: D("sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06", "tokens.txt"),
    decodingMethod: "greedy_search",
  },
];

// LibriSpeech clips ship with every model; they flatter the LibriSpeech-trained one, so
// read the transcripts, not just the WER.
const WAVS = [
  D("sherpa-onnx-streaming-zipformer-en-2023-06-26", "test_wavs", "0.wav"),
  D("sherpa-onnx-streaming-zipformer-en-2023-06-26", "test_wavs", "1.wav"),
];

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);

function wer(ref, hyp) {
  const r = norm(ref), h = norm(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 0; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / r.length;
}

const pct = (x) => (x * 100).toFixed(1) + "%";
const ms = (x) => x.toFixed(1) + " ms";

for (const cfg of CONFIGS) {
  if (!fs.existsSync(cfg.tokens)) { console.log(`\n## ${cfg.name}\n   SKIPPED - not downloaded`); continue; }

  const t0 = process.hrtime.bigint();
  let rec;
  try {
    rec = new sherpa.OnlineRecognizer({
      modelConfig: {
        transducer: cfg.transducer,
        tokens: cfg.tokens,
        ...(cfg.modelType ? { modelType: cfg.modelType } : {}),
        numThreads: THREADS,
        provider: "cpu",
      },
      featConfig: { sampleRate: 16000, featureDim: 80 },
      decodingMethod: cfg.decodingMethod,
      ...(cfg.maxActivePaths ? { maxActivePaths: cfg.maxActivePaths } : {}),
      enableEndpoint: false,
    });
  } catch (e) {
    console.log(`\n## ${cfg.name}\n   FAILED to load: ${e.message}`);
    continue;
  }
  const loadMs = Number(process.hrtime.bigint() - t0) / 1e6;

  console.log(`\n## ${cfg.name}`);
  console.log(`   load: ${(loadMs / 1000).toFixed(1)} s`);

  // The first few frames of the first stream pay for ONNX arena allocation and cache
  // warm-up - real dictation never sees that cost twice, so warm the recogniser first.
  {
    const warm = rec.createStream();
    const { samples, sampleRate } = sherpa.readWave(WAVS[0]);
    warm.acceptWaveform({ sampleRate, samples: samples.subarray(0, sampleRate * 3) });
    while (rec.isReady(warm)) rec.decode(warm);
  }

  const frameTimes = [];
  let audioSec = 0;
  for (const wav of WAVS) {
    const { samples, sampleRate } = sherpa.readWave(wav);
    audioSec += samples.length / sampleRate;
    const stream = rec.createStream();
    const FRAME = Math.round(sampleRate * 0.1);
    for (let i = 0; i < samples.length; i += FRAME) {
      const chunk = samples.subarray(i, Math.min(i + FRAME, samples.length));
      const s = process.hrtime.bigint();
      stream.acceptWaveform({ sampleRate, samples: chunk });
      while (rec.isReady(stream)) rec.decode(stream);
      frameTimes.push(Number(process.hrtime.bigint() - s) / 1e6);
    }
    stream.acceptWaveform({ sampleRate, samples: new Float32Array(8000) });
    stream.inputFinished();
    while (rec.isReady(stream)) rec.decode(stream);

    const hyp = rec.getResult(stream).text;
    const refFile = path.join(path.dirname(wav), "trans.txt");
    let ref = "";
    if (fs.existsSync(refFile)) {
      const key = path.basename(wav);
      const line = fs.readFileSync(refFile, "utf8").split("\n").find((l) => l.includes(key));
      if (line) ref = line.replace(key, "").trim();
    }
    console.log(`   ${path.basename(wav)}: ${ref ? `WER ${pct(wer(ref, hyp))}` : "no ref"}`);
    console.log(`      ${hyp.trim().toLowerCase()}`);
  }

  frameTimes.sort((a, b) => a - b);
  const sum = frameTimes.reduce((a, b) => a + b, 0);
  const p = (q) => frameTimes[Math.min(frameTimes.length - 1, Math.floor(q * frameTimes.length))];
  console.log(`   per-100ms-frame decode: median ${ms(p(0.5))}  p95 ${ms(p(0.95))}  max ${ms(p(1))}`);
  console.log(`   RTF: ${(sum / 1000 / audioSec).toFixed(3)}  (${audioSec.toFixed(1)} s audio)`);
}
