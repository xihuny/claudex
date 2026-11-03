// xterm + its WebGL renderer are ~380 kB of the bundle and are needed only once a
// terminal pane actually mounts - chat is the default mode, so most sessions never
// touch them. They're therefore pulled in by dynamic import here rather than at the
// top level (this module itself IS eagerly imported by App.tsx for setViewing/resize,
// so a static import would keep xterm in the main chunk no matter what TerminalView
// does). `import type` below is erased at compile time and costs nothing.
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { toast } from "sonner";
import { getToken, wsUrl, WS_UNAUTHORIZED, notifyUnauthorized } from "@/lib/api";

interface Session {
  term: Terminal;
  fit: FitAddon;
  ws: WebSocket | null;
  el: HTMLElement | null;
  closing: boolean;
  retry: number;
  retryTimer: number | null;
}

const sessions = new Map<string, Session>();

// Slugs whose xterm import is in flight. A pane can unmount (tab closed, switched back
// to chat) before the chunk resolves, so end()/dispose() need a way to cancel a mount
// that hasn't built its Terminal yet - otherwise the session would spring into
// existence, and open a socket, after the thing that asked for it was gone.
const pendingMounts = new Map<string, { el: HTMLElement; cancelled: boolean }>();

type XtermModules = {
  Terminal: typeof import("@xterm/xterm").Terminal;
  FitAddon: typeof import("@xterm/addon-fit").FitAddon;
  WebglAddon: typeof import("@xterm/addon-webgl").WebglAddon;
};
let xtermPromise: Promise<XtermModules> | null = null;
function loadXterm(): Promise<XtermModules> {
  if (!xtermPromise) {
    xtermPromise = Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-webgl"),
    ]).then(([x, f, w]) => ({ Terminal: x.Terminal, FitAddon: f.FitAddon, WebglAddon: w.WebglAddon }));
  }
  return xtermPromise;
}

// Warm the chunk once the app is idle, so switching to terminal mode still feels
// instant even though the code is no longer in the critical path. Failure is ignored:
// mount() will simply await the same promise and surface any real error there.
export function prefetchTerminal() {
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  const go = () => { loadXterm().catch(() => { xtermPromise = null; }); };
  if (idle) idle(go, { timeout: 4000 }); else setTimeout(go, 2000);
}

// which session the user is currently looking at (null when the app is hidden) - // the server uses this to suppress notifications for a session you're watching.
let viewingSlug: string | null = null;
export function setViewing(slug: string | null) {
  viewingSlug = slug;
  for (const [sl, s] of sessions) send(s, { type: "viewing", data: sl === slug });
}

// xterm renders to a canvas, so it can't inherit CSS custom properties - its palette has
// to be read out and handed over as literal values, and re-handed on every theme change
// (see the cx-theme-change listener below), or the terminal stays dark inside a light UI.
function themeVars() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const bg = v("--color-bg", "#0a0a0b");
  const accent = v("--color-accent", "#2bff88");
  return {
    background: bg,
    // Terminal body text is the app's foreground pulled a little toward the accent, which
    // is what gave the original its faint green cast; mixing keeps that in every palette.
    foreground: `color-mix(in srgb, ${v("--color-fg", "#ededef")} 88%, ${accent})`,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: `color-mix(in srgb, ${accent} 30%, transparent)`,
    black: v("--color-panel", "#15151a"),
    brightBlack: v("--color-muted", "#3a3a42"),
    green: accent,
    brightGreen: v("--color-accent2", "#5dffaa"),
    // ANSI colours the CLI actually emits - without these the terminal keeps its
    // built-in red/yellow/blue, which clash badly inside Nord or Solarized.
    red: v("--color-danger", "#f0506e"),
    brightRed: v("--color-danger", "#f0506e"),
    yellow: v("--color-warn", "#f0b429"),
    brightYellow: v("--color-warn2", "#f5c451"),
    cyan: v("--color-accent2", "#5dffaa"),
    brightCyan: v("--color-accent2", "#5dffaa"),
    white: v("--color-fg", "#ededef"),
    brightWhite: v("--color-fg", "#ededef"),
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("cx-theme-change", () => {
    const t = themeVars();
    for (const s of sessions.values()) {
      try { s.term.options.theme = t; } catch {}
    }
  });
}

function send(s: Session, obj: unknown) {
  if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify(obj));
}

// A lost network usually leaves the socket half-open: readyState stays OPEN but onclose
// never fires, so the backoff reconnect never arms. Terminal frames are raw PTY bytes (no
// room for an app-level pong to measure), so we lean on the OS signals below to force a
// reconnect when connectivity returns; the server's ping-sweep reaps its own dead side.
function forceReconnect(slug: string, s: Session) {
  if (s.closing) return;
  if (s.retryTimer) { clearTimeout(s.retryTimer); s.retryTimer = null; }
  if (s.ws) { s.ws.onclose = null; try { s.ws.close(); } catch {} s.ws = null; }
  s.retry = 0;
  connect(slug, s);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { for (const [slug, s] of sessions) forceReconnect(slug, s); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    for (const [slug, s] of sessions) if (!s.ws || s.ws.readyState !== 1) forceReconnect(slug, s);
  });
}

function connect(slug: string, s: Session) {
  const ws = new WebSocket(wsUrl(slug));
  s.ws = ws;
  ws.onopen = () => {
    if (s.retry) s.term.write("\r\n\x1b[38;5;141m[reconnected]\x1b[0m\r\n");
    s.retry = 0;
    const t = getToken();
    if (t) ws.send(JSON.stringify({ token: t }));
    resize(slug);
    send(s, { type: "viewing", data: slug === viewingSlug });
  };
  ws.onmessage = (e) => s.term.write(e.data);
  ws.onclose = (ev) => {
    if (s.closing) return;
    if (ev.code === WS_UNAUTHORIZED) { s.closing = true; notifyUnauthorized(); return; }   // stale token: log in again, don't loop
    const delay = Math.min(500 * 2 ** s.retry, 15000);
    s.retry++;
    s.term.write(`\r\n\x1b[38;5;245m[disconnected, reconnecting in ${Math.round(delay / 1000) || 1}s…]\x1b[0m\r\n`);
    s.retryTimer = window.setTimeout(() => connect(slug, s), delay);
  };
}

export function mount(slug: string, el: HTMLElement) {
  const s = sessions.get(slug);
  if (s) {
    // re-attach existing terminal to the (possibly new) element
    if (s.el !== el) { el.innerHTML = ""; s.term.open(el); s.el = el; queueResize(slug); }
    return;
  }
  // Re-mounting into a new element while the first import is still in flight (fast
  // tab switching): retarget the pending mount rather than starting a second one.
  const pending = pendingMounts.get(slug);
  if (pending) { pending.el = el; return; }

  const token = { el, cancelled: false };
  pendingMounts.set(slug, token);
  loadXterm().then((xt) => {
    pendingMounts.delete(slug);
    if (token.cancelled || sessions.has(slug)) return;
    build(slug, token.el, xt);
  }).catch(() => {
    pendingMounts.delete(slug);
    xtermPromise = null;   // let a later mount retry rather than caching the failure
    if (!token.cancelled) toast.error("Could not load the terminal");
  });
}

function build(slug: string, el: HTMLElement, { Terminal, FitAddon, WebglAddon }: XtermModules) {
  let s: Session | undefined;
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,            // integer - fractional sizes mis-align the WebGL glyph grid (input lag)
    scrollback: 6000,        // lineHeight left at default 1.0; non-1.0 degrades the renderer
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
    theme: themeVars(),
    allowProposedApi: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  try { term.loadAddon(new WebglAddon()); } catch {}
  // Stop iOS showing the password/location autofill bar over the keyboard.
  // autocomplete="off" is IGNORED by iOS; autocomplete="one-time-code" makes iOS
  // treat it as an OTP field and show no password/contact autofill suggestions.
  const ta = term.textarea;
  if (ta) {
    ta.setAttribute("autocomplete", "one-time-code");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("autocapitalize", "off");
    ta.setAttribute("spellcheck", "false");
    ta.removeAttribute("name");
  }
  s = { term, fit, ws: null, el, closing: false, retry: 0, retryTimer: null };
  sessions.set(slug, s);
  term.onData((d) => send(s!, { type: "input", data: d }));

  // Shift+Enter inserts a newline instead of submitting. Terminals can't tell
  // Shift+Enter from Enter (both emit \r), so intercept the keydown and send \n
  // (0x0A) - Claude Code treats \n as "insert newline", \r as "submit".
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === "keydown" && e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      send(s!, { type: "input", data: "\n" });
      return false; // stop xterm from also emitting \r
    }
    return true;
  });

  // (Wheel goes to tmux, which scrolls its output scrollback - see USE_TMUX
  // `mouse on` server-side. Without tmux, xterm scrolls its own buffer natively.)

  // Selection → clipboard. Desktop: drag-select, release to copy. Mobile: the
  // terminal renders to a canvas (no native selection), so long-press a word to
  // select + copy it.
  const copySel = (txt: string | undefined) => {
    const t = (txt || "").trim();
    if (!t) return;
    navigator.clipboard?.writeText(t).then(() => toast.success("Copied", { duration: 1100 })).catch(() => {});
  };
  el.addEventListener("mouseup", () => { if (term.hasSelection()) copySel(term.getSelection()); });

  function selectWordAt(cx: number, cy: number) {
    const screen = el.querySelector(".xterm-screen") as HTMLElement | null;
    if (!screen || !term.cols || !term.rows) return;
    const r = screen.getBoundingClientRect();
    const col = Math.max(0, Math.min(term.cols - 1, Math.floor((cx - r.left) / (r.width / term.cols))));
    const vrow = Math.max(0, Math.min(term.rows - 1, Math.floor((cy - r.top) / (r.height / term.rows))));
    const buf = term.buffer.active;
    const line = buf.getLine(buf.viewportY + vrow);
    if (!line) return;
    const text = line.translateToString(true);
    const isW = (ch: string) => !!ch && !/\s/.test(ch);
    if (!isW(text[col])) return;
    let s = col, e = col;
    while (s > 0 && isW(text[s - 1])) s--;
    while (e < text.length - 1 && isW(text[e + 1])) e++;
    term.select(s, buf.viewportY + vrow, e - s + 1);
    copySel(text.slice(s, e + 1));
  }

  let lpTimer = 0, lpX = 0, lpY = 0, lpActive = false;
  el.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    lpX = e.touches[0].clientX; lpY = e.touches[0].clientY; lpActive = true;
    lpTimer = window.setTimeout(() => { lpActive = false; selectWordAt(lpX, lpY); }, 450);
  }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    if (!lpActive || e.touches.length !== 1) return;
    if (Math.hypot(e.touches[0].clientX - lpX, e.touches[0].clientY - lpY) > 12) { clearTimeout(lpTimer); lpActive = false; }
  }, { passive: true });
  el.addEventListener("touchend", () => { clearTimeout(lpTimer); lpActive = false; }, { passive: true });

  connect(slug, s);
  queueResize(slug);
}

function queueResize(slug: string) { requestAnimationFrame(() => resize(slug)); }

export function resize(slug: string) {
  const s = sessions.get(slug);
  if (!s) return;
  try { s.fit.fit(); } catch {}
  send(s, { type: "resize", cols: s.term.cols, rows: s.term.rows });
}

export function focus(slug: string) { sessions.get(slug)?.term.focus(); }

export function input(slug: string, data: string) {
  const s = sessions.get(slug);
  if (s) send(s, { type: "input", data });
}

// Leaving terminal mode (switched to chat, or tab closed): tell the server to end
// the CLI's claude so chat can resume the shared session, then tear down locally.
export function end(slug: string) {
  const s = sessions.get(slug);
  if (!s) return dispose(slug);   // may still be a pending mount to cancel
  try { if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify({ type: "end" })); } catch {}
  dispose(slug);
}

export function dispose(slug: string) {
  // Cancel a mount whose xterm chunk is still downloading, so it doesn't build a
  // terminal (and connect a socket) for a pane that has already gone away.
  const pending = pendingMounts.get(slug);
  if (pending) { pending.cancelled = true; pendingMounts.delete(slug); }
  const s = sessions.get(slug);
  if (!s) return;
  s.closing = true;
  if (s.retryTimer) clearTimeout(s.retryTimer);
  try { s.ws?.close(); } catch {}
  s.term.dispose();
  sessions.delete(slug);
}

export function isOpen(slug: string) { return sessions.has(slug); }
