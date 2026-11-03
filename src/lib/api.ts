// A share is its own URL - /s/<token> - and its token is read from that path on every
// load, never written to storage.
//
// This is the whole point: localStorage is scoped to the ORIGIN, not the path, so a share
// that saved its token would overwrite the owner's on the same browser and strand them in
// the guest view. Keeping the credential in the path instead means the owner's session at
// "/" is untouched, two different shares can be open side by side, and a reload or a
// bookmark still works because the address itself carries everything.
const SHARE_PATH = /^\/s\/([A-Za-z0-9_-]{8,})\/?$/;
function shareToken(): string {
  const m = SHARE_PATH.exec(location.pathname);
  return m ? m[1] : "";
}
/** True when this tab is a share, not the owner's app. */
export const isShareUrl = () => !!shareToken();

// Links issued before shares had their own path put the token in the fragment. Send those
// to the real URL rather than leaving early invites broken - this navigates, so nothing
// after it runs.
(function migrateHashShareLink() {
  const m = /(?:^|[#&])share=([^&]+)/.exec(location.hash);
  if (m) location.replace("/s/" + encodeURIComponent(decodeURIComponent(m[1])));
})();

let TOKEN = shareToken() || localStorage.getItem("cx_token") || "";
export const getToken = () => TOKEN;
// Persist only for the owner. A share must never touch cx_token - that key belongs to
// whoever owns this browser, and clobbering it is exactly the bug this layout prevents.
export const setToken = (t: string) => { TOKEN = t; if (!isShareUrl()) localStorage.setItem("cx_token", t); };
export const clearToken = () => { TOKEN = ""; if (!isShareUrl()) localStorage.removeItem("cx_token"); };

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };
// For the websocket clients: the server closes an unauthenticated socket with this code.
// A client seeing it must stop reconnecting and show the login, not retry forever (each
// retry counts as a failed login and would lock this address out).
export const WS_UNAUTHORIZED = 4003;
export const notifyUnauthorized = () => { onUnauthorized?.(); };

export const authHeaders = (): Record<string, string> => (TOKEN ? { "X-Token": TOKEN } : {});

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  const opt: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(url, opt);
  if (r.status === 401) { onUnauthorized?.(); throw new Error("Unauthorized"); }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as any).error || r.statusText);
  }
  return r.json();
}

export async function uploadImage(file: File, rel?: string): Promise<string> {
  const data: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const r = await fetch("/upload", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, data, rel }),
  });
  if (!r.ok) throw new Error(`Upload failed (${r.status})`);
  const j = await r.json();
  return j.path as string;
}

// Browser URL for an uploaded file (absolute server path or bare name). No token in the
// URL: <img src> can't set the X-Token header, so these GETs are gated by the HttpOnly
// file cookie minted by ensureFileCookie(). Mirrors GET /uploads/:name.
export function uploadUrl(p: string): string {
  const name = p.split(/[\\/]/).pop() || "";
  return `/uploads/${encodeURIComponent(name)}`;
}

// Raw-bytes URL for a file inside a project (image previews, downloads). Same cookie gate.
export function fsFileUrl(session: string, path: string, dl = false): string {
  const q = new URLSearchParams({ session, path });
  if (dl) q.set("dl", "1");
  return `/api/fs/file?${q}`;
}

// Ask the server for the file cookie (see uploadUrl). Called once the token is known to
// work; harmless to repeat, so boot and login both do it.
export async function ensureFileCookie(): Promise<void> {
  try { await fetch("/api/file-cookie", { method: "POST", headers: authHeaders() }); } catch { /* images 401 until the next try */ }
}

// Exchange the password for a session token. The browser then stores that token, never
// the password; the server can forget it (logout) without the password changing.
export async function login(password: string): Promise<void> {
  const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error || (r.status === 429 ? "Too many attempts, try again later" : "Wrong password")); }
  const j = await r.json();
  setToken(String(j.token || ""));
  await ensureFileCookie();
}

export function wsUrl(session: string) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws?session=${encodeURIComponent(session)}`;
}
