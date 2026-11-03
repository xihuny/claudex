import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getToken } from "@/lib/api";

// Voice typing against the streaming recogniser on the server (server/asr.js).
//
// The browser's own SpeechRecognition would be simpler, but WebKit refuses to run it
// inside a home-screen web app - which is how this app is normally opened on iOS. So we
// capture the mic ourselves and stream 16 kHz PCM up the websocket, getting words back
// while you are still talking rather than after you stop.

export type DictationState = "idle" | "starting" | "listening";

const SILENCE_STOP_MS = 12000;   // close a mic left open in a quiet room
const MAX_TAKE_MS = 300000;
const SPEECH_RMS = 0.012;
const TARGET_RATE = 16000;
const FRAME = 1600;              // 100 ms at 16 kHz - the recogniser's decode step

const canRecord = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/**
 * Linear resampler that survives across audio callbacks. Keeping the fractional read
 * position between blocks matters: rounding it every 85 ms would drop or repeat a sample
 * each time, and the recogniser hears that as a click.
 *
 * Only used as a fallback. Picking every third sample of a 48 kHz stream is decimation
 * without a filter, so everything the mic captured above 8 kHz folds back down into the
 * speech band as noise - sibilants land on top of vowels and the acoustic model has to
 * work through it. The lowpass cascade in start() removes that content first; when the
 * AudioContext can be opened at 16 kHz outright, this runs at ratio 1 and does nothing.
 */
class Resampler {
  private pos = 0;
  private tail = new Float32Array(0);
  constructor(private readonly ratio: number) {}

  push(input: Float32Array): Int16Array {
    const buf = new Float32Array(this.tail.length + input.length);
    buf.set(this.tail);
    buf.set(input, this.tail.length);

    const out: number[] = [];
    let p = this.pos;
    while (Math.ceil(p) < buf.length) {
      const lo = Math.floor(p), hi = Math.min(lo + 1, buf.length - 1);
      const s = Math.max(-1, Math.min(1, buf[lo] + (buf[hi] - buf[lo]) * (p - lo)));
      out.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      p += this.ratio;
    }
    const consumed = Math.floor(p);
    this.tail = buf.slice(consumed);
    this.pos = p - consumed;
    return Int16Array.from(out);
  }
}

const join = (a: string, b: string) => (a && b ? a + " " + b : a + b);

/**
 * Dictation into a text draft. `getBase()` is read once when the mic opens and the
 * transcript is appended to that snapshot, so the in-progress words can be rewritten in
 * place as the recogniser revises them.
 */
export function useDictation({ getBase, onUpdate }: { getBase: () => string; onUpdate: (text: string) => void }) {
  const [state, setState] = useState<DictationState>("idle");
  const [available, setAvailable] = useState<boolean | null>(null);

  const wantRef = useRef(false);
  const baseRef = useRef("");        // draft as it was when the mic opened
  const doneRef = useRef("");        // segments the recogniser has committed
  const partialRef = useRef("");     // the segment still being spoken
  const cbRef = useRef({ getBase, onUpdate });
  cbRef.current = { getBase, onUpdate };

  const wsRef = useRef<WebSocket | null>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<Int16Array[]>([]);   // audio captured while the models load
  const mediaRef = useRef<{ stream: MediaStream; ctx: AudioContext; node: ScriptProcessorNode } | null>(null);

  useEffect(() => {
    if (!canRecord) { setAvailable(false); return; }
    let alive = true;
    const t = getToken();
    fetch("/api/asr/status", { headers: t ? { "X-Token": t } : {} })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((j) => alive && setAvailable(!!j.available))
      .catch(() => alive && setAvailable(false));
    return () => { alive = false; };
  }, []);

  const emit = () => {
    const spoken = join(doneRef.current, partialRef.current).trim();
    const base = baseRef.current;
    cbRef.current.onUpdate(base && spoken ? base.replace(/\s*$/, "") + " " + spoken : base + spoken);
  };

  const teardown = useCallback(() => {
    const m = mediaRef.current;
    mediaRef.current = null;
    if (m) {
      try { m.node.disconnect(); } catch { /* ok */ }
      try { m.ctx.close(); } catch { /* ok */ }
      m.stream.getTracks().forEach((t) => t.stop());
    }
    const ws = wsRef.current;
    wsRef.current = null;
    readyRef.current = false;
    queueRef.current = [];
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Ask for the tail of the last segment, then let the socket close on its own so
      // the final words still arrive.
      try { ws.send(JSON.stringify({ t: "flush" })); } catch { /* ok */ }
      setTimeout(() => { try { ws.close(); } catch { /* ok */ } }, 1500);
    } else if (ws) {
      try { ws.close(); } catch { /* ok */ }
    }
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    teardown();
    setState("idle");
  }, [teardown]);

  const start = useCallback(async () => {
    if (wantRef.current || !canRecord) return;
    wantRef.current = true;
    baseRef.current = cbRef.current.getBase();
    doneRef.current = "";
    partialRef.current = "";
    setState("starting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: TARGET_RATE,   // a hint; most platforms hand back 48 kHz anyway
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e: any) {
      wantRef.current = false;
      setState("idle");
      toast.error(e?.name === "NotAllowedError" ? "Microphone access denied" : "Could not open the microphone");
      return;
    }
    if (!wantRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }

    const tok = getToken();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/asr`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    // The token goes in the first frame, never in the URL (URLs end up in logs).
    ws.onopen = () => { try { ws.send(JSON.stringify({ t: "auth", token: tok })); } catch { /* ok */ } };

    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.t === "ready") {
        readyRef.current = true;
        if (wantRef.current) setState("listening");
        for (const q of queueRef.current.splice(0)) { try { ws.send(q.buffer as ArrayBuffer); } catch { /* ok */ } }
        return;
      }
      if (msg.t === "partial") { partialRef.current = msg.text || ""; emit(); return; }
      if (msg.t === "final") {
        partialRef.current = "";
        if (msg.text) doneRef.current = join(doneRef.current, msg.text);
        emit();
        return;
      }
      if (msg.t === "error") { toast.error(msg.message || "Voice typing failed"); stop(); }
    };
    ws.onerror = () => { if (wantRef.current) { toast.error("Voice typing disconnected"); stop(); } };
    ws.onclose = () => { if (wantRef.current) stop(); };

    // Ask for a 16 kHz graph. Where the browser honours it, its own resampler - properly
    // filtered - does the rate conversion and ours becomes a no-op; where it doesn't, we
    // fall back to filtering by hand below.
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    let ctx: AudioContext;
    try { ctx = new AC({ sampleRate: TARGET_RATE }); } catch { ctx = new AC(); }
    await ctx.resume().catch(() => { /* already running */ });
    const resampler = new Resampler(ctx.sampleRate / TARGET_RATE);
    const src = ctx.createMediaStreamSource(stream);

    // Anti-alias ahead of the decimation. One biquad rolls off at 12 dB/octave, which
    // still leaves plenty of energy at 12 kHz to fold back over the speech band, so
    // cascade three for ~36 dB/octave. The corner sits just under Nyquist for 16 kHz.
    let head: AudioNode = src;
    if (ctx.sampleRate > TARGET_RATE) {
      for (let i = 0; i < 3; i++) {
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = TARGET_RATE * 0.45;
        lp.Q.value = Math.SQRT1_2;
        head.connect(lp);
        head = lp;
      }
    }

    // ScriptProcessor is deprecated but it is the one node that works everywhere iOS
    // ships - an AudioWorklet needs a module URL the service worker would have to serve.
    const node = ctx.createScriptProcessor(4096, 1, 1);
    let pending: number[] = [];
    let lastLoud = performance.now();
    const startedAt = lastLoud;

    node.onaudioprocess = (e) => {
      if (!wantRef.current) return;
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const now = performance.now();
      if (Math.sqrt(sum / input.length) > SPEECH_RMS) lastLoud = now;
      if (now - lastLoud > SILENCE_STOP_MS || now - startedAt > MAX_TAKE_MS) { stop(); return; }

      // Ship whole 100 ms frames - that is the recogniser's decode step, so smaller
      // packets would just add websocket overhead for no earlier result.
      for (const s of resampler.push(input)) pending.push(s);
      while (pending.length >= FRAME) {
        const frame = Int16Array.from(pending.splice(0, FRAME));
        if (readyRef.current && ws.readyState === WebSocket.OPEN) ws.send(frame.buffer as ArrayBuffer);
        else if (queueRef.current.length < 300) queueRef.current.push(frame);   // ~30 s of warm-up
      }
    };
    head.connect(node);
    node.connect(ctx.destination);   // Safari won't run the processor unless it's connected
    mediaRef.current = { stream, ctx, node };
  }, [stop]);

  const toggle = useCallback(() => { wantRef.current ? stop() : void start(); }, [start, stop]);

  // Sending abandons the take - nothing in flight may rewrite a draft that already left.
  const cancel = useCallback(() => {
    wantRef.current = false;
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) { try { ws.close(); } catch { /* ok */ } }
    const m = mediaRef.current;
    mediaRef.current = null;
    if (m) {
      try { m.node.disconnect(); } catch { /* ok */ }
      try { m.ctx.close(); } catch { /* ok */ }
      m.stream.getTracks().forEach((t) => t.stop());
    }
    readyRef.current = false;
    queueRef.current = [];
    setState("idle");
  }, []);

  useEffect(() => () => { wantRef.current = false; cancel(); }, [cancel]);

  return {
    supported: available !== false,
    state,
    listening: state === "listening",
    starting: state === "starting",
    toggle,
    stop,
    cancel,
  };
}
