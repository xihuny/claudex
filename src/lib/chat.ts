// Client side of chat mode: one resilient WebSocket per project to /chat, with a
// small reducer that turns the server's normalised events into a transcript.
// Mirrors lib/terminals.ts (module-level session map, auto-reconnect).
import { getToken, WS_UNAUTHORIZED, notifyUnauthorized } from "@/lib/api";

export interface ToolItem {
  kind: "tool";
  id: string;
  name: string;
  input: any;
  result?: string;
  isError?: boolean;
  status: "running" | "done";
  local?: boolean;   // the user ran this themselves via "!cmd" - not a tool Claude chose
  image?: string;    // upload name of an image the tool returned (see GET /uploads/:name)
}
export interface TextItem {
  kind: "user" | "assistant";
  text: string;
  streaming?: boolean;
  at?: number;   // epoch ms the user sent this (user items only; absent on pre-timestamp transcripts)
}
export interface AskOption { label: string; description?: string; }
export interface AskQuestion { header?: string; question: string; multiSelect?: boolean; allowOther?: boolean; options: AskOption[]; }
export interface AskItem {
  kind: "ask";
  id: string;
  questions: AskQuestion[];
  answered?: boolean;
  answers?: string[][];   // selected labels per question
  note?: string;          // free-text reply when the user discussed instead of picking
  stale?: boolean;        // the process died still parked on it - nothing is listening for an answer
}
export interface UsageItem {
  kind: "usage";
  in: number;          // fresh input tokens
  cacheRead: number;   // input served from prompt cache (cheap)
  cacheCreate: number; // input written to cache (the expensive rewrites - the spike tell)
  out: number;         // generated output tokens
  ms: number;          // wall-clock duration of the turn
  ctx: number;         // accurate end-of-turn context size (for the % gauge)
  window: number;      // the model's usable context window (for the % gauge)
}
export interface NoticeItem {
  kind: "notice";
  text: string;
  variant?: string;   // e.g. "compact" - lets the UI pick an icon/tone
}
// One evaluation of an active /goal, mirroring the CLI's own transcript entry. `met`
// false with `failed` false is the interesting case: the Stop hook just BLOCKED the
// turn from ending, so Claude carries on with `reason` as its feedback.
export interface GoalStatusItem {
  kind: "goal_status";
  met: boolean;
  failed: boolean;      // judged impossible - the goal is abandoned, not achieved
  condition: string;
  reason?: string;      // the evaluator's justification, quoting the transcript
  iterations?: number;  // turns the goal took (present on the final entry)
  durationMs?: number;
  tokens?: number;
}
export type ChatItem = TextItem | ToolItem | AskItem | UsageItem | NoticeItem | GoalStatusItem;
// The goal currently in force. Lives only as long as the `claude` process that enforces
// it, so the server drops it (with a notice) if that process goes away.
export interface GoalInfo {
  condition: string;
  setAt: number;        // ms - drives the "running 5m" elapsed readout
  iterations: number;   // times the evaluator has said "not yet"
  lastReason: string;   // what it said the last time
}
// Current model/effort for the composer pill. `id` is the raw model id the live process
// reported (e.g. "claude-fable-5"), `chosen` the user's /model pick (alias like
// "sonnet[1m]"), `def` the global default from settings - display uses the first known.
export interface ModelInfo {
  id: string | null;
  chosen: string | null;
  effort: string | null;
  def: string | null;
  window: number;
  /** settings.json advisorModel ("opus", or a full id). Global, not per session. */
  advisor: string | null;
  /** Why the advisor is inactive in this chat (main model ranks above it); null = active or unset. */
  advisorOff: string | null;
}
const EMPTY_MODEL: ModelInfo = { id: null, chosen: null, effort: null, def: null, window: 0, advisor: null, advisorOff: null };

interface ChatState {
  ws: WebSocket | null;
  hydrated: boolean;   // true once the initial "history" snapshot has arrived
  items: ChatItem[];
  running: boolean;
  since: number;    // ms timestamp the current turn started - for the elapsed timer
  lastTurnAt: number; // ms timestamp the last turn finished (server-persisted) - for the cold-cache hint
  status: string;   // live activity label ("Thinking…", "Running Bash…", "Compacting…")
  bg: number;       // background tasks still running - outlives the turn, so NOT tied to `running`
  goal: GoalInfo | null;   // active /goal, or null
  queue: string[];
  model: ModelInfo;
  listeners: Set<() => void>;
  retry: number;
  retryTimer: number | null;
  hbTimer: number | null;   // app-level ping interval - detects a half-open socket
  lastRecvAt: number;       // ms of the last frame from the server (incl. pongs)
  connected: boolean;       // socket is open - drives the "Reconnecting…" indicator
  epoch: string;            // server's log identity; mismatch ⇒ our seq is meaningless
  seq: number;              // last event seq applied - replayed from here on reconnect
}

const chats = new Map<string, ChatState>();

// Which session the user is actively viewing (null when away/idle/hidden). Mirrors
// terminals.setViewing - the server reads it over BOTH sockets to suppress pushes for a
// session you're watching. Chat mode never opened a terminal socket, so without this the
// "I'm looking at it" signal never reached the server and pushes fired while in-app.
// Notified once per turn when a chat finishes (running goes true→false), for ANY open
// session - App uses it to flag a project's sidebar capsule when you're not watching it.
let finishCb: ((slug: string) => void) | null = null;
export function setChatFinishHandler(fn: ((slug: string) => void) | null) { finishCb = fn; }

let viewingSlug: string | null = null;
export function setViewing(slug: string | null) {
  viewingSlug = slug;
  for (const [sl, c] of chats) if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: "viewing", data: sl === slug }));
}

function chatUrl(slug: string, c: ChatState) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const q = new URLSearchParams({ session: slug });
  // Ask for a diff rather than the whole transcript. The server honours it only when its
  // epoch matches and the gap is still in its retained window, so a wrong guess costs
  // nothing - it just replies with a full history like before.
  if (c.epoch && c.seq) { q.set("epoch", c.epoch); q.set("since", String(c.seq)); }
  return `${proto}://${location.host}/chat?${q}`;
}
function get(slug: string): ChatState {
  let c = chats.get(slug);
  if (!c) { c = { ws: null, hydrated: false, items: [], running: false, since: 0, lastTurnAt: 0, status: "", bg: 0, goal: null, queue: [], model: EMPTY_MODEL, listeners: new Set(), retry: 0, retryTimer: null, hbTimer: null, lastRecvAt: 0, connected: false, epoch: "", seq: 0 }; chats.set(slug, c); }
  return c;
}
function rawSend(c: ChatState, text: string) { if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: "send", text })); }
function emit(c: ChatState) { for (const fn of c.listeners) fn(); }

function reduce(c: ChatState, ev: any) {
  const last = c.items[c.items.length - 1];
  switch (ev.t) {
    case "user":
      c.items = [...c.items, { kind: "user", text: ev.text, at: Number(ev.at) || undefined }];
      break;
    case "delta":
      if (last && last.kind === "assistant" && last.streaming) {
        c.items = [...c.items.slice(0, -1), { ...last, text: last.text + ev.text }];
      } else {
        c.items = [...c.items, { kind: "assistant", text: ev.text, streaming: true }];
      }
      break;
    case "assistant":
      if (last && last.kind === "assistant" && last.streaming) {
        c.items = [...c.items.slice(0, -1), { kind: "assistant", text: ev.text }];
      } else {
        c.items = [...c.items, { kind: "assistant", text: ev.text }];
      }
      break;
    case "tool":
      c.items = [...c.items, { kind: "tool", id: ev.id, name: ev.name, input: ev.input, status: "running", local: !!ev.local }];
      break;
    case "tool_progress":
      // Live output from a still-running "!cmd" - transient (never in the replay log),
      // so a reconnect just shows the card running until its final tool_result lands.
      c.items = c.items.map((it) => (it.kind === "tool" && it.id === ev.id ? { ...it, result: ev.result } : it));
      break;
    case "tool_result":
      c.items = c.items.map((it) => (it.kind === "tool" && it.id === ev.id ? { ...it, result: ev.result, isError: ev.is_error, image: ev.image, status: "done" } : it));
      break;
    case "result":
      // NOTE: don't clear running here - the server only frees its own turn guard on
      // process close (the "running:false" event, which arrives just after). Draining
      // the queue on "result" would send the next message while the server is still
      // busy and it'd be dropped. Wait for "running" below.
      if (last && last.kind === "assistant" && last.streaming) c.items = [...c.items.slice(0, -1), { ...last, streaming: false }];
      if (ev.ok === false && ev.error) {
        // Errors like "hit your session limit" arrive BOTH as a plain assistant message
        // and as the result error. Upgrade that plain copy in place to the single ⚠️ line
        // (the nicer one) instead of leaving the plain one or echoing a duplicate.
        const tail = c.items[c.items.length - 1];
        const text = "⚠️ " + ev.error;
        if (tail && tail.kind === "assistant" && tail.text.includes(ev.error))
          c.items = [...c.items.slice(0, -1), { kind: "assistant", text }];
        else
          c.items = [...c.items, { kind: "assistant", text }];
      }
      break;
    case "running":
      // Stamp the turn start the instant the turn begins (every turn emits exactly one
      // running:true). Doing it here - not in a React effect - means it resets per turn
      // even when back-to-back turns get coalesced into a single render frame.
      if (ev.running) c.since = Date.now();
      c.running = ev.running;
      if (!ev.running) c.status = "";
      break;
    case "status":
      c.status = typeof ev.status === "string" ? ev.status : "";
      break;
    case "bg":
      c.bg = Number(ev.n) || 0;
      break;
    case "goal":
      c.goal = ev.goal ? { condition: String(ev.goal.condition || ""), setAt: Number(ev.goal.setAt) || Date.now(), iterations: Number(ev.goal.iterations) || 0, lastReason: String(ev.goal.lastReason || "") } : null;
      break;
    case "goal_status":
      c.items = [...c.items, { kind: "goal_status", met: !!ev.met, failed: !!ev.failed, condition: String(ev.condition || ""), reason: ev.reason || "", iterations: ev.iterations, durationMs: ev.durationMs, tokens: ev.tokens }];
      break;
    case "model":
      c.model = { id: ev.id ?? null, chosen: ev.chosen ?? null, effort: ev.effort ?? null, def: ev.def ?? null, window: Number(ev.window) || 0, advisor: ev.advisor ?? null, advisorOff: ev.advisorOff ?? null };
      break;
    case "queue":
      c.queue = Array.isArray(ev.queue) ? ev.queue : [];
      break;
    case "ask":
      c.items = [...c.items, { kind: "ask", id: ev.id, questions: Array.isArray(ev.questions) ? ev.questions : [] }];
      break;
    case "usage":
      c.items = [...c.items, { kind: "usage", in: ev.in || 0, cacheRead: ev.cacheRead || 0, cacheCreate: ev.cacheCreate || 0, out: ev.out || 0, ms: ev.ms || 0, ctx: ev.ctx || 0, window: ev.window || 0 }];
      break;
    case "notice":
      c.items = [...c.items, { kind: "notice", text: String(ev.text || ""), variant: ev.kind }];
      break;
    case "ask_resolved":
      // `stale` = the server had no live question under this id (its process is gone), so
      // the card unlocks as expired rather than reading as genuinely answered.
      c.items = c.items.map((it) => (it.kind === "ask" && it.id === ev.id ? { ...it, answered: true, answers: ev.answers, note: ev.note, stale: !!ev.stale } : it));
      break;
    case "cleared":
      c.items = [];
      c.running = false;
      c.status = "";
      c.queue = [];
      break;
  }
}

// A lost network usually leaves the socket half-open: readyState stays OPEN but no frames
// flow and onclose never fires, so the backoff reconnect never arms and sends vanish. The
// client pings on an interval; if nothing (not even the pong) has arrived within STALE_MS,
// the socket is dead and we tear it down and reconnect. Mirrors the server ping/terminate.
const HEARTBEAT_MS = 25000;
const STALE_MS = 60000;

function stopHeartbeat(c: ChatState) { if (c.hbTimer) { clearInterval(c.hbTimer); c.hbTimer = null; } }
function startHeartbeat(slug: string, c: ChatState) {
  stopHeartbeat(c);
  c.hbTimer = window.setInterval(() => {
    const ws = c.ws;
    if (!ws || ws.readyState !== 1) return;
    if (Date.now() - c.lastRecvAt > STALE_MS) { forceReconnect(slug, c); return; }
    try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
  }, HEARTBEAT_MS);
}

// Drop the current socket (without letting its onclose schedule a delayed retry) and
// reconnect immediately. Used by the heartbeat and by the online/visibility handlers so a
// restored network resyncs at once instead of waiting out the backoff.
function forceReconnect(slug: string, c: ChatState) {
  stopHeartbeat(c);
  if (c.retryTimer) { clearTimeout(c.retryTimer); c.retryTimer = null; }
  if (c.ws) { c.ws.onclose = null; try { c.ws.close(); } catch {} c.ws = null; }
  c.retry = 0;
  c.connected = false;
  emit(c);
  connect(slug, c);
}

if (typeof window !== "undefined") {
  // Network restored: every existing socket is suspect (may be half-open) - reconnect all.
  window.addEventListener("online", () => { for (const [slug, c] of chats) forceReconnect(slug, c); });

  // Returning from the background. readyState is NOT a liveness test here: a phone that
  // suspended the page comes back with the socket still reading OPEN while the server has
  // long since reaped it, so the old `readyState !== 1` check saw nothing wrong and left
  // the app on a dead socket until the heartbeat next fired - up to 25s of a stale screen,
  // and only THEN a reconnect. Instead, probe anything that hasn't heard from the server
  // recently and reconnect if the pong doesn't come back promptly.
  const PROBE_MS = 1200;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    for (const [slug, c] of chats) {
      if (!c.ws || c.ws.readyState !== 1) { forceReconnect(slug, c); continue; }
      if (Date.now() - c.lastRecvAt < HEARTBEAT_MS) continue;   // heard from it just now - fine
      const before = c.lastRecvAt;
      const ws = c.ws;
      try { ws.send(JSON.stringify({ type: "ping" })); } catch { forceReconnect(slug, c); continue; }
      window.setTimeout(() => { if (c.ws === ws && c.lastRecvAt === before) forceReconnect(slug, c); }, PROBE_MS);
    }
  });
}

function connect(slug: string, c: ChatState) {
  const ws = new WebSocket(chatUrl(slug, c));
  c.ws = ws;
  ws.onopen = () => { c.retry = 0; c.lastRecvAt = Date.now(); c.connected = true; const t = getToken(); if (t) ws.send(JSON.stringify({ token: t })); ws.send(JSON.stringify({ type: "viewing", data: slug === viewingSlug })); startHeartbeat(slug, c); emit(c); };
  ws.onmessage = (e) => {
    c.lastRecvAt = Date.now();
    let m: any; try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === "pong") return;   // liveness only - stamped above, carries no state
    const wasRunning = c.running;
    if (m.t === "history" || m.t === "sync") {
      // "history" is the full transcript and replaces what we have; "sync" is only the
      // events we missed while disconnected and appends to it. Both carry the same
      // authoritative live fields below, so the rest of this branch is shared.
      c.hydrated = true;
      if (m.t === "history") c.items = [];
      for (const ev of m.events || []) reduce(c, ev);
      c.epoch = String(m.epoch || "");
      c.seq = Number(m.seq) || 0;
      // Partial text of a turn that's mid-stream. Replaces any streaming item rather than
      // appending, so it's the same result whether we watched part of the stream or none.
      const tail = c.items[c.items.length - 1];
      if (tail && tail.kind === "assistant" && tail.streaming) c.items = c.items.slice(0, -1);
      if (m.running && m.stream) c.items = [...c.items, { kind: "assistant", text: String(m.stream), streaming: true }];
      // The frame's live fields are applied AFTER the replay - they're authoritative.
      // The persisted log can end mid-turn (server killed before it logged
      // running:false, e.g. a self-restart via Run Claudex.command); replaying that
      // stale running:true last would leave the composer stuck on Stop + "Working…".
      c.running = !!m.running;
      // Keep the existing start time across a resync - the turn didn't restart just
      // because our socket did, and re-stamping it made the elapsed timer jump to 0:00.
      c.since = m.running ? (wasRunning && c.since ? c.since : Date.now()) : 0;
      c.lastTurnAt = Number(m.lastTurnAt) || 0;
      c.status = m.running ? (m.status || "") : "";
      c.bg = Number(m.bg) || 0;   // authoritative: background work survives a reconnect
      c.goal = m.goal ? { condition: String(m.goal.condition || ""), setAt: Number(m.goal.setAt) || Date.now(), iterations: Number(m.goal.iterations) || 0, lastReason: String(m.goal.lastReason || "") } : null;
      c.queue = Array.isArray(m.queue) ? m.queue : [];
      if (m.model) c.model = { id: m.model.id ?? null, chosen: m.model.chosen ?? null, effort: m.model.effort ?? null, def: m.model.def ?? null, window: Number(m.model.window) || 0, advisor: m.model.advisor ?? null, advisorOff: m.model.advisorOff ?? null };
      // Same stale-turn cleanup for transcript items the killed turn left behind. An
      // unanswered ask_user card is the worst of these to leave live: the question is held
      // open by the claude process, so if that process is gone (server restart, crash)
      // nothing is listening for the answer - and the composer routes messages into the
      // dead question as discussion replies, so the chat looks wedged. A parked question
      // always has a live process, i.e. running:true, so !running means orphaned.
      if (!c.running) c.items = c.items.map((it) =>
        it.kind === "tool" && it.status === "running" ? { ...it, status: "done" as const }
        : it.kind === "assistant" && it.streaming ? { ...it, streaming: false }
        : it.kind === "ask" && !it.answered ? { ...it, answered: true, stale: true }
        : it);
    }
    else {
      reduce(c, m);
      // Logged events carry a seq; transient ones (queue, bg, tool_progress, delta) don't.
      // Tracking it here is what lets the next reconnect ask for a diff instead of the lot.
      if (typeof m.seq === "number") c.seq = m.seq;
      // Live turn boundaries only (replayed history events must NOT stamp "now" -       // the history frame carries the real, persisted lastTurnAt).
      if (m.t === "result") c.lastTurnAt = Date.now();
      else if (m.t === "cleared") c.lastTurnAt = 0;
    }
    if (wasRunning && !c.running) { try { finishCb?.(slug); } catch {} }   // turn just finished
    emit(c);
  };
  ws.onclose = (ev) => {
    c.ws = null;
    c.connected = false;
    stopHeartbeat(c);
    if (ev.code === WS_UNAUTHORIZED) { emit(c); notifyUnauthorized(); return; }   // stale token: log in again, don't loop
    const delay = Math.min(500 * 2 ** c.retry, 15000);
    c.retry++;
    c.retryTimer = window.setTimeout(() => connect(slug, c), delay);
    emit(c);
  };
}

export function mountChat(slug: string) { const c = get(slug); if (!c.ws) connect(slug, c); return c; }
// Permanently tear down a chat session's client state - close the socket without
// reconnecting and drop it from the map. For closing/deleting a session (NOT for a
// mere pane unmount, which keeps the socket warm so switching tabs is instant).
export function disposeChat(slug: string) {
  const c = chats.get(slug);
  if (!c) return;
  if (c.retryTimer) { clearTimeout(c.retryTimer); c.retryTimer = null; }
  stopHeartbeat(c);
  if (c.ws) { c.ws.onclose = null; try { c.ws.close(); } catch {} c.ws = null; }
  c.listeners.clear();
  chats.delete(slug);
}
// Just send - the server runs it now if idle, or queues it and runs it next.
// The queue lives on the server (authoritative), echoed back via "queue" events.
export function enqueueChat(slug: string, text: string) { rawSend(get(slug), text); }
export function chatQueue(slug: string) { return get(slug).queue; }
export function removeQueued(slug: string, index: number) {
  const c = get(slug);
  if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: "dequeue", index }));
}
export function sendChat(slug: string, text: string) { rawSend(get(slug), text); }
// Run a bash command the user typed as "!cmd". Deliberately not a chat turn: the server
// runs it in the project dir, streams a tool card into the transcript, and holds the
// output for the next message - so Claude sees it without this costing a turn.
export function sendBash(slug: string, command: string) {
  const c = get(slug);
  if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: "bash", command }));
}
// Kill a running "!cmd" and everything it spawned.
export function stopBash(slug: string, id: string) {
  const c = get(slug);
  if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: "bash_stop", id }));
}
export function stopChat(slug: string) { const c = get(slug); if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: "stop" })); }
// Submit the user's response to an ask_user question; answers is the chosen labels
// per question, note is a free-text reply when the user typed in the composer to
// discuss instead of picking. The server returns both to Claude as the tool result.
export function answerChat(slug: string, id: string, answers: string[][], note?: string) {
  const c = get(slug);
  if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: "answer", id, answers, note: note || "" }));
}
export function clearChat(slug: string) { const c = get(slug); if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: "clear" })); }
export function subscribeChat(slug: string, fn: () => void) { const c = get(slug); c.listeners.add(fn); return () => c.listeners.delete(fn); }
export function chatItems(slug: string) { return get(slug).items; }
export function chatHydrated(slug: string) { return get(slug).hydrated; }
export function chatConnected(slug: string) { return get(slug).connected; }
export function chatRunning(slug: string) { return get(slug).running; }
export function chatStatus(slug: string) { return get(slug).status; }
export function chatBg(slug: string) { return get(slug).bg; }
export function chatGoal(slug: string) { return get(slug).goal; }
export function chatSince(slug: string) { return get(slug).since; }
export function chatModel(slug: string) { return get(slug).model; }
export function chatLastTurnAt(slug: string) { return get(slug).lastTurnAt; }
