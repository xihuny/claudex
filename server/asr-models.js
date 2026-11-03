// Which streaming recogniser to run, and what it can do on its own.
//
// Two models are supported because the machines this runs on don't all have the same one
// downloaded. Both the bridge (asr.js) and the worker (asr-worker.js) resolve through
// here so they can never disagree about whether speech is available.
//
// Set ASR_MODEL=kroko|librispeech to pin one; otherwise the best installed one wins.
import path from "path";
import os from "os";
import fs from "fs";

export const SHERPA_DIR = process.env.SHERPA_DIR || path.join(os.homedir(), ".local/opt/sherpa");
export const PUNCT_DIR = path.join(SHERPA_DIR, "sherpa-onnx-online-punct-en-2024-08-06");

const D = (...p) => path.join(SHERPA_DIR, ...p);

// Ordered best-first. `punctuates` is the important flag: a model whose token inventory
// already contains ",", ".", "?" and mixed-case pieces writes its own sentences, so we
// must NOT run it through the punctuation model - that path lowercases the whole string
// first and would throw away every capital the recogniser got right.
export const PROFILES = [
  {
    id: "kroko",
    dir: D("sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06"),
    files: { encoder: "encoder.onnx", decoder: "decoder.onnx", joiner: "joiner.onnx" },
    punctuates: true,
    note: "Kroko community zipformer (CC-BY-SA), cased + punctuated",
  },
  {
    id: "librispeech",
    dir: D("sherpa-onnx-streaming-zipformer-en-2023-06-26"),
    files: {
      encoder: "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
      decoder: "decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
      joiner: "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
    },
    punctuates: false,
    note: "icefall zipformer trained on LibriSpeech only - ALL CAPS, needs the punctuation model",
  },
];

const installed = (p) =>
  fs.existsSync(path.join(p.dir, "tokens.txt")) &&
  Object.values(p.files).every((f) => fs.existsSync(path.join(p.dir, f)));

/** The profile we will actually load, or null if no model is downloaded. */
export function resolveProfile() {
  const pinned = process.env.ASR_MODEL;
  if (pinned) {
    const p = PROFILES.find((x) => x.id === pinned);
    if (p && installed(p)) return p;
    if (p) console.warn(`[asr] ASR_MODEL=${pinned} is not downloaded; falling back`);
  }
  return PROFILES.find(installed) || null;
}

/** Absolute paths for the recogniser, ready to hand to sherpa-onnx. */
export function profilePaths(p) {
  return {
    encoder: path.join(p.dir, p.files.encoder),
    decoder: path.join(p.dir, p.files.decoder),
    joiner: path.join(p.dir, p.files.joiner),
    tokens: path.join(p.dir, "tokens.txt"),
  };
}
