// Voice typing: browser mic → this bridge → asr-worker.js → text, live.
//
// Why a bridge and not just a POST: Whisper-style batch transcription can't start until
// you stop talking and bills a padded 30 s window per pass, which is how a two-word
// "hello" ended up taking five seconds. A streaming recogniser decodes each 100 ms of
// audio as it arrives, so the words appear while you speak and the last one lands about
// as fast as the network can carry it.
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { createRequire } from "module";
import { resolveProfile } from "./asr-models.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IDLE_MS = 15 * 60 * 1000;   // drop the models after a quiet spell

export function asrAvailable() {
  try {
    createRequire(import.meta.url).resolve("sherpa-onnx-node");
  } catch {
    return false;
  }
  return !!resolveProfile();
}

let worker = null;          // the shared recogniser process
let ready = false;          // has it finished loading the models?
let waiters = [];           // resolvers waiting on that load
let idleTimer = null;
const sessions = new Map(); // id → ws

function killWorker() {
  if (!worker) return;
  const w = worker;
  worker = null;
  ready = false;
  try { w.kill(); } catch { /* already gone */ }
}

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (sessions.size === 0) killWorker(); }, IDLE_MS);
  idleTimer.unref?.();
}

function ensureWorker() {
  if (ready) return Promise.resolve(true);
  if (!worker) {
    worker = spawn(process.execPath, [path.join(__dirname, "asr-worker.js")], {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv(),
    });
    worker.stderr.on("data", (d) => {
      const s = String(d).trim();
      if (s) console.warn("[asr]", s.split("\n").slice(-1)[0]);
    });
    worker.on("exit", () => {
      const dead = worker;
      killWorker();
      if (dead) for (const ws of sessions.values()) { try { ws.close(); } catch { /* ok */ } }
      waiters.splice(0).forEach((r) => r(false));
    });

    let buf = "";
    worker.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.t === "ready") { ready = true; waiters.splice(0).forEach((r) => r(true)); continue; }
        const ws = sessions.get(msg.id);
        if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
      }
    });
  }
  return new Promise((resolve) => waiters.push(resolve));
}

const toWorker = (obj) => {
  if (worker && ready) { try { worker.stdin.write(JSON.stringify(obj) + "\n"); } catch { /* worker died */ } }
};

// Dictation is CPU-heavy, so the number of live recognisers is bounded: a handful for the
// owner's own devices, fewer for guests, who share one pool between them.
const MAX_SESSIONS = 6;
const MAX_GUEST_SESSIONS = 2;
let childEnv = () => process.env;

/** Wire up GET /api/asr/status and the /asr websocket.
 *  `isOwner(tok)` / `isGuest(tok)` classify a token; dictation is local speech-to-text
 *  over the user's own words, so a share can have it too. The socket authenticates with
 *  its FIRST text frame ({ t: "auth", token }), never with a token in the URL. */
export function registerAsr({ app, authed, isOwner, isGuest, env }) {
  if (env) childEnv = env;
  const classify = (tok) => (isOwner(tok) ? "owner" : isGuest(tok) ? "guest" : null);
  app.get("/api/asr/status", (req, res) => {
    if (!authed(req) && !isGuest(req.headers["x-token"])) return res.sendStatus(401);
    const ok = asrAvailable();
    // Loading the models takes ~10-16 s. The composer asks this on mount, which is the
    // earliest honest signal that someone might dictate - start warming now so the mic
    // is instant when it's actually tapped, and let the idle timer reap it if it isn't.
    if (ok && !worker) { ensureWorker().then(() => armIdle()); }
    res.json({ available: ok, loaded: ready });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  let nextId = 1;
  let guestLive = 0;

  wss.on("connection", (ws) => {
    const fail = (message) => { try { ws.send(JSON.stringify({ t: "error", message })); ws.close(); } catch { /* ok */ } };
    let role = null;
    const authTimer = setTimeout(() => { if (!role) { try { ws.close(4001, "auth timeout"); } catch { /* ok */ } } }, 10000);
    ws.once("message", async (data, isBinary) => {
      clearTimeout(authTimer);
      let msg = null;
      if (!isBinary) { try { msg = JSON.parse(String(data)); } catch { /* fallthrough */ } }
      role = msg && msg.t === "auth" ? classify(msg.token) : null;
      if (!role) { try { ws.close(4003, "unauthorized"); } catch { /* ok */ } return; }
      if (!asrAvailable()) return fail("Speech models not installed");
      if (sessions.size >= MAX_SESSIONS || (role === "guest" && guestLive >= MAX_GUEST_SESSIONS)) return fail("Voice typing is busy right now, try again in a moment");
      const id = String(nextId++);
      sessions.set(id, ws);
      if (role === "guest") guestLive++;
      clearTimeout(idleTimer);

      ws.on("message", (d, bin) => {
        // Binary frames are raw 16 kHz mono Int16 PCM; text frames are control.
        if (bin) { toWorker({ t: "audio", id, pcm: Buffer.from(d).toString("base64") }); return; }
        let m;
        try { m = JSON.parse(String(d)); } catch { return; }
        if (m.t === "flush") toWorker({ t: "close", id });
      });

      ws.on("close", () => {
        toWorker({ t: "close", id });
        sessions.delete(id);
        if (role === "guest") guestLive--;
        armIdle();
      });

      const ok = await ensureWorker();
      if (!ok) return fail("Speech engine failed to start");
      toWorker({ t: "open", id });
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: "ready" }));
    });
  });

  return {
    /** Called from the shared upgrade router in index.js (which has already checked Origin). */
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    },
  };
}
