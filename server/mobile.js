// Flutter mobile runner - run a Flutter project on a connected device from the UI.
// Device discovery rides ONE persistent `flutter daemon` (the same JSON-RPC stream
// the VS Code extension uses), so connect/disconnect events keep the server's device
// list current with no polling. App runs use `flutter run --machine`: structured
// progress/log events plus real hot-reload / hot-restart RPCs (app.restart) instead
// of faking `r`/`R` keystrokes into a pty.
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, execFile, execSync } from "child_process";

const isWin = process.platform === "win32";
const SHELL = process.env.SHELL_CMD || (isWin ? "powershell.exe" : process.env.SHELL || "bash");
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

// ---- flutter binary discovery ----
// pm2's env has no login-shell PATH (flutter is usually PATH'd in .zshrc), so check
// the common install spots directly, then fall back to a login-shell lookup.
const FLUTTER_PATHS = [
  path.join(os.homedir(), "development/flutter/bin/flutter"),
  path.join(os.homedir(), "flutter/bin/flutter"),
  path.join(os.homedir(), "fvm/default/bin/flutter"),
  "/opt/homebrew/bin/flutter",
  "/usr/local/bin/flutter",
];
let FLUTTER_BIN; // undefined = not looked up yet; null = not installed
function flutterBin() {
  if (FLUTTER_BIN !== undefined) return FLUTTER_BIN;
  FLUTTER_BIN = FLUTTER_PATHS.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
  if (!FLUTTER_BIN && !isWin) {
    try {
      const out = execSync(`${SHELL} -lic 'command -v flutter'`, { timeout: 10000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      FLUTTER_BIN = out.split("\n").pop() || null; // last line - an interactive shell may print banners first
    } catch {}
  }
  return FLUTTER_BIN;
}

// Same rule as index.js childEnv(): no claudex secrets reach a child process.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("CLAUDE_CODE_") || k === "TOKEN" || k === "CX_ASK_TOKEN" || k === "CX_HOOK_TOKEN") delete env[k];
  return env;
}
// Spawn a flutter command through an interactive login shell (`exec` hands the shell's
// pid + stdio straight to flutter) so it sees the user's real PATH / ANDROID_HOME /
// JAVA_HOME - same reason dev servers use `SHELL -lic` in index.js.
function spawnFlutter(args, opts) {
  const bin = flutterBin();
  if (isWin) return spawn(bin, args, opts);
  return spawn(SHELL, ["-lic", `exec ${shq(bin)} ${args.map(shq).join(" ")}`], opts);
}

// ---- project detection ----
// A Flutter project = pubspec.yaml with a flutter section/dependency. One small file
// read, cached by mtime, so the status endpoint can call it every poll.
const kindCache = {}; // dir -> { mtime, flutter }
function isFlutterProject(dir) {
  const f = path.join(dir, "pubspec.yaml");
  let st; try { st = fs.statSync(f); } catch { return false; }
  const c = kindCache[dir];
  if (c && c.mtime === st.mtimeMs) return c.flutter;
  let flutter = false;
  try { flutter = /(^|\n)\s*(flutter\s*:|sdk\s*:\s*flutter)/.test(fs.readFileSync(f, "utf8")); } catch {}
  kindCache[dir] = { mtime: st.mtimeMs, flutter };
  return flutter;
}

// ---- daemon protocol plumbing ----
// Both `flutter daemon` and `flutter run --machine` frame every message as a
// one-element JSON array per line: [{"event":...}] / [{"id":N,"result":...}].
function splitter(onLine) {
  let buf = "";
  return (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (line.trim()) onLine(line); }
  };
}
function parseMsg(line) {
  const t = line.trim();
  if (!t.startsWith("[{")) return null;
  try { const a = JSON.parse(t); return Array.isArray(a) && a[0] && typeof a[0] === "object" ? a[0] : null; } catch { return null; }
}
// Write one JSON-RPC request into `target` ({ proc, nextId, pending }) and await its reply.
function rpc(target, method, params, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const proc = target.proc;
    if (!proc || proc.exitCode != null || !proc.stdin.writable) return reject(new Error("process not running"));
    const id = target.nextId++;
    const timer = setTimeout(() => { target.pending.delete(id); reject(new Error(method + " timed out")); }, timeoutMs);
    target.pending.set(id, { resolve, reject, timer });
    try { proc.stdin.write(JSON.stringify([{ id, method, ...(params ? { params } : {}) }]) + "\n"); }
    catch (e) { clearTimeout(timer); target.pending.delete(id); reject(e); }
  });
}
// Resolve a pending rpc() from an incoming message; true if it was one.
function settleRpc(target, m) {
  if (m.id == null || !target.pending.has(m.id)) return false;
  const p = target.pending.get(m.id);
  target.pending.delete(m.id); clearTimeout(p.timer);
  if (m.error) p.reject(new Error(typeof m.error === "string" ? m.error : JSON.stringify(m.error)));
  else p.resolve(m.result);
  return true;
}
function rejectAll(target, why) {
  for (const p of target.pending.values()) { clearTimeout(p.timer); p.reject(new Error(why)); }
  target.pending = new Map();
}

// ---- device daemon (one for the whole server) ----
// MAX_DAEMON_AGE: a `flutter daemon` cannot be trusted to stay a live source of truth.
// Measured on this machine: a daemon under ~30s old reports device connects/disconnects
// correctly, by around two minutes it stops noticing new ones, and a day-old one is frozen
// at the snapshot it took at startup - still answering device.getDevices, just with stale
// data. device.discoverDevices doesn't revive it, and nothing in the protocol distinguishes
// "frozen" from "nothing changed", so the only reliable repair is a new process. One is
// spawned every MAX_DAEMON_AGE of *idle* Flutter UI (never during a run - a running app
// doesn't need the list, and its `flutter run` process is unaffected either way), on top
// of the watcher's change-triggered swaps below, and the outgoing list stays on screen
// for the ~3s the replacement takes to report.
const MAX_DAEMON_AGE = 180000;
// Grace period after a spawn during which nothing may recycle the daemon. A fresh
// process is by definition not stale, and discovery takes several seconds to complete
// (xcdevice's network pass finds a wireless iPhone last) - so acting on a "something
// changed" signal that lands in that window just restarts discovery from zero. Plugging
// a phone in moves the watcher's fingerprint more than once, and without this floor each
// move killed the daemon mid-discovery: the list stayed half-built or empty for as long
// as the changes kept coming, which looked exactly like a frozen device list.
const MIN_DAEMON_AGE = 12000;
const daemon = {
  proc: null, devices: new Map(), emulators: [], emulatorsAt: 0, devicesAt: 0, listedAt: 0,
  startedAt: 0, recycling: false, swapTimer: null, failures: 0, nextId: 1, pending: new Map(), backoffUntil: 0,
};

// SIGKILL the whole process group. `flutter daemon` spawns adb/xcdevice children that
// inherit its pipes, so signalling the leader alone can leave them running - and holding
// stdout open, which is what used to make a recycle hang (see swapDaemon).
function hardKill(proc) {
  if (!proc) return;
  try { process.kill(-proc.pid, "SIGKILL"); } catch {}
  try { proc.kill("SIGKILL"); } catch {}
}

function ensureDaemon() {
  if (daemon.proc) return true;
  if (Date.now() < daemon.backoffUntil) return false; // crash-loop guard
  if (!flutterBin()) return false;
  // Detached = its own process group, so hardKill above can take the children with it.
  const proc = spawnFlutter(["daemon"], { env: cleanEnv(), detached: true });
  daemon.proc = proc;
  daemon.startedAt = Date.now();
  daemon.devicesAt = 0;
  daemon.listedAt = 0;
  daemon.failures = 0;
  // Devices deliberately survive a respawn: the outgoing daemon's list is the best guess
  // until the new one reports, and blanking it would flash "No device" every recycle.
  if (!daemon.recycling) daemon.devices = new Map();
  daemon.recycling = false;
  proc.stdout.on("data", splitter((line) => {
    const m = parseMsg(line);
    if (!m || daemon.proc !== proc) return;
    if (settleRpc(daemon, m)) return;
    if (m.event === "device.added" || m.event === "device.changed") { const d = m.params; if (d && d.id) daemon.devices.set(d.id, d); }
    else if (m.event === "device.removed") { const d = m.params; if (d && d.id) daemon.devices.delete(d.id); }
    // Only once the daemon has announced itself is it certainly the one reading our
    // stdin: we spawn it through `SHELL -lic 'exec flutter daemon'`, and an INTERACTIVE
    // shell reads ahead from stdin before exec - anything written earlier is eaten by the
    // shell. A lost device.enable left polling off, so slow discoveries (iOS, whose
    // `xcdevice list` takes seconds) never appeared: only devices fast enough to answer
    // the one-shot getDevices below made it into the list.
    else if (m.event === "daemon.connected") enableDevices(proc);
  }));
  proc.stderr.on("data", () => {});
  proc.on("error", () => {});
  // Both events, once: "exit" fires when the process dies, while "close" waits for every
  // inherited pipe to shut - a surviving adb/xcdevice grandchild can delay it forever,
  // and listening for "close" alone is how a recycle got stuck mid-swap, freezing the
  // device list until the server was restarted.
  proc.on("exit", () => daemonGone(proc));
  proc.on("close", () => daemonGone(proc));
  // A daemon that never says hello (wrong binary, broken shell rc) still gets the old
  // best-effort treatment rather than sitting mute forever.
  setTimeout(() => { if (daemon.proc === proc && !daemon.devicesAt) enableDevices(proc); }, 3000);
  return true;
}
// The daemon is gone (or has been declared gone). Idempotent: a process reports both
// "exit" and "close", and the swap watchdog may have moved on already.
function daemonGone(proc) {
  if (daemon.proc !== proc) return;
  if (daemon.swapTimer) { clearTimeout(daemon.swapTimer); daemon.swapTimer = null; }
  daemon.proc = null; daemon.devicesAt = 0; daemon.listedAt = 0; daemon.failures = 0;
  rejectAll(daemon, "flutter daemon exited");
  if (daemon.recycling) { ensureDaemon(); return; }   // planned swap - no devices lost, no backoff
  daemon.devices = new Map();
  daemon.backoffUntil = Date.now() + 15000; // the next status call retries
}
// Subscribe to live add/remove events, then seed with what's already connected - // device.added only covers *new* connections on some daemon versions.
function enableDevices(proc) {
  if (daemon.proc !== proc || daemon.devicesAt) return;
  daemon.devicesAt = Date.now();
  rpc(daemon, "device.enable").catch(() => {});
  refreshDevices(true);
  refreshEmulators(true);   // same stdin race: only ask once the daemon is listening
}
// Re-ask for the full list. Events keep the map current in normal operation; this is the
// repair path (a discovery that was still warming up at startup, or one that died), and
// it costs one RPC the daemon answers from its own poller.
function refreshDevices(force) {
  if (!daemon.proc) return;
  if (!force && Date.now() - daemon.devicesAt < 10000) return;
  daemon.devicesAt = Date.now();
  const proc = daemon.proc;
  rpc(daemon, "device.getDevices", null, 20000).then((list) => {
    if (daemon.proc !== proc || !Array.isArray(list)) return;
    daemon.failures = 0;
    daemon.listedAt = Date.now();
    const next = new Map();
    for (const d of list) if (d && d.id) next.set(d.id, d);
    daemon.devices = next;
  }).catch(() => {
    // A daemon that stops answering its own RPC is useless even while its process is
    // alive: it would keep serving the frozen snapshot forever. Two misses and it goes.
    if (daemon.proc !== proc || daemon.recycling) return;
    if (++daemon.failures >= 2) recycleDaemon(false, true);
  });
}
// Replace a daemon that has aged past MAX_DAEMON_AGE (see the constant). Called from the
// status route, so it only ever happens while someone is actually watching the bar.
function recycleDaemon(skip, now) {
  if (!daemon.proc || daemon.recycling || skip) return;
  if (Date.now() - daemon.startedAt < MIN_DAEMON_AGE) return;   // see the constant
  if (!now && Date.now() - daemon.startedAt < MAX_DAEMON_AGE) return;
  swapDaemon();
}
// Kill the current daemon and bring up a fresh one, keeping the outgoing device list on
// screen meanwhile. The replacement is normally spawned by the exit handler; the watchdog
// covers the old process refusing to die or its exit never being reported, which
// otherwise left `recycling` latched on and every later recycle a no-op.
function swapDaemon() {
  const old = daemon.proc;
  if (!old) { ensureDaemon(); return; }
  daemon.recycling = true;
  daemon.failures = 0;
  rejectAll(daemon, "daemon recycled");
  try { old.kill("SIGTERM"); } catch {}
  if (daemon.swapTimer) clearTimeout(daemon.swapTimer);
  daemon.swapTimer = setTimeout(() => {
    daemon.swapTimer = null;
    if (daemon.proc !== old) return;   // the exit handler already swapped it
    // Still here after 3s: take the whole process group, then orphan the handle. Every
    // handler is guarded by `daemon.proc === proc`, so a late event from the old process
    // can no longer touch the replacement's state.
    hardKill(old);
    daemon.proc = null; daemon.devicesAt = 0; daemon.listedAt = 0;
    ensureDaemon();
  }, 3000);
}
// Full reset behind the dock's rescan button: unlike a recycle this drops the cached
// list and any crash-loop backoff, then waits for the new daemon's first real answer so
// the response carries a rebuilt list rather than the old one.
let resetting = null;
function resetDaemon() {
  // Two tabs hitting rescan at once must not race two daemons into existence - the
  // second caller waits on the first reset and gets the same rebuilt list.
  if (!resetting) resetting = doReset().finally(() => { resetting = null; });
  return resetting;
}
async function doReset() {
  const old = daemon.proc;
  if (daemon.swapTimer) { clearTimeout(daemon.swapTimer); daemon.swapTimer = null; }
  rejectAll(daemon, "daemon reset");
  daemon.recycling = false;          // a reset, not a swap: nothing here is worth keeping
  daemon.proc = null;
  daemon.devices = new Map();
  daemon.emulators = []; daemon.emulatorsAt = 0; daemon.devicesAt = 0; daemon.listedAt = 0;
  daemon.failures = 0;
  daemon.backoffUntil = 0;           // the user asked for this; don't sit out a backoff
  if (old) { try { old.kill("SIGTERM"); } catch {} setTimeout(() => hardKill(old), 2000); }
  // Re-baseline the watcher against the new daemon, so its first pass can't read as a
  // change and immediately recycle what we just spawned. The busy flags are cleared too:
  // if a probe ever wedged, the watcher would be silently dead, and these probes are
  // read-only, so an overlapping one costs nothing.
  watch.sig = ""; watch.ios = ""; watch.sim = "";
  watch.fastBusy = false; watch.slowBusy = false; watch.fastAt = 0; watch.slowAt = 0;
  // Android devices reach flutter through adb, so a flutter daemon inherits whatever the
  // adb server currently believes - a server that has lost track of the USB bus keeps a
  // phone invisible no matter how many daemons we spawn. Bounce it as part of the manual
  // rescan (never while an app is running: that connection goes through adb too).
  const adb = adbBin();
  if (adb && !Object.keys(runs).length) {
    await new Promise((r) => execFile(adb, ["kill-server"], { timeout: 8000 }, () => r()));
    await new Promise((r) => execFile(adb, ["start-server"], { timeout: 15000 }, () => r()));
  }
  if (!ensureDaemon()) return false;
  // Wait for the first full listing, then keep asking until the count holds still: the
  // slow discoverers trickle in after it (a wireless iPhone needs xcdevice's network
  // pass, seconds behind macOS/Chrome), and returning half a list makes the button look
  // broken. Capped, so a machine with nothing attached still answers promptly.
  const started = daemon.proc;
  const t0 = Date.now();
  let last = -1, stable = 0;
  while (Date.now() - t0 < 12000 && daemon.proc === started) {
    await new Promise((r) => setTimeout(r, 600));
    if (!daemon.listedAt) continue;
    const n = daemon.devices.size;
    if (n === last) stable++; else { last = n; stable = 0; }
    // The floor matters: macOS/Chrome answer in ~3s and would otherwise look "settled"
    // while xcdevice is still finding the phones, which is the whole point of pressing it.
    if (stable >= 3 && Date.now() - t0 > 6500) break;
    refreshDevices(true);
  }
  return true;
}

// ---- live change watcher ----
// The daemon owns the device list, but can't be trusted to notice a change promptly (see
// MAX_DAEMON_AGE). These probes never build a list themselves - they're only a trigger.
// Each is cheap enough to run on a short cadence, and the moment their combined
// fingerprint moves the daemon is replaced, so the real list rebuilds within ~3s. The
// slower probes ride every Nth tick, keeping a plugged-in phone to ~3s, a booted
// simulator to ~6s and a wireless iPhone (which needs xcdevice's network discovery,
// ~6s of waiting for well under a second of CPU) to ~20s.
const ADB_PATHS = [
  process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, "platform-tools/adb"),
  path.join(os.homedir(), "Library/Android/sdk/platform-tools/adb"),
  "/opt/homebrew/bin/adb", "/usr/local/bin/adb",
].filter(Boolean);
let ADB_BIN;
function adbBin() {
  if (ADB_BIN === undefined) ADB_BIN = ADB_PATHS.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
  return ADB_BIN;
}
const run = (cmd, args, timeout) => new Promise((res) => {
  execFile(cmd, args, { timeout, maxBuffer: 8e6 }, (e, out) => res(e ? "" : String(out)));
});
const watch = { sig: "", fastAt: 0, fastBusy: false, slowAt: 0, slowBusy: false, sim: "", ios: "" };

// Compare the fingerprint and, the moment it moves, replace the daemon - the first pass
// only records, having nothing to compare against yet.
function settleSig(sig) {
  if (watch.sig && sig !== watch.sig) { recycleDaemon(false, true); refreshEmulators(true); }
  watch.sig = sig;
}
// Fast lane (~3s): cable + Android + booted simulators, ~0.5s of work.
async function watchDevices() {
  // The busy flag is ignored once a pass has clearly overrun (a probe hung despite its
  // timeout): a latched flag would otherwise stop the watcher for good.
  if (isWin || (watch.fastBusy && Date.now() - watch.fastAt < 60000) || Date.now() - watch.fastAt < 3000) return;
  watch.fastBusy = true; watch.fastAt = Date.now();
  try {
    const io = await run("/usr/sbin/ioreg", ["-p", "IOUSB", "-l", "-w0"], 5000);
    const usb = (io.match(/"USB Serial Number" = "[^"]+"/g) || []).sort().join("|");
    const adb = adbBin();
    watch.sim = await run("/usr/bin/xcrun", ["simctl", "list", "devices", "booted"], 10000);
    settleSig([usb, adb ? (await run(adb, ["devices"], 5000)).trim() : "", watch.sim, watch.ios].join("#"));
  } finally { watch.fastBusy = false; }
  watchIosWireless();
}
// Slow lane (~20s), on its own flag so it never holds up the fast one: a wireless iPhone
// is only visible to xcdevice, which waits ~6s on network discovery per call.
async function watchIosWireless() {
  if ((watch.slowBusy && Date.now() - watch.slowAt < 90000) || Date.now() - watch.slowAt < 20000) return;
  watch.slowBusy = true; watch.slowAt = Date.now();
  try {
    const xc = await run("/usr/bin/xcrun", ["xcdevice", "list"], 25000);
    const list = JSON.parse(xc || "[]");
    const ios = list.filter((d) => d && !d.simulator).map((d) => d.identifier + ":" + (d.available !== false)).sort().join("|");
    if (ios !== watch.ios) { watch.ios = ios; settleSig(watch.sig.replace(/[^#]*$/, ios)); }
  } catch {}
  finally { watch.slowBusy = false; }
}
// Does the USB bus hold something that looks like an Android phone? ioreg names the
// gadget ("SM8150-MTP", "Galaxy…"), which is enough to tell "plugged in but adb can't see
// it" - USB debugging off, or its prompt never accepted - from "nothing plugged in".
// Without that distinction a rescan can only say "no devices", which reads as a bug in
// claudex when the phone is sitting right there on the cable.
const PHONE_HINTS = /oneplus|samsung|galaxy|xiaomi|redmi|poco|oppo|vivo|realme|huawei|honor|motorola|moto |nothing phone|pixel|infinix|tecno|-mtp|android|adb/i;
async function usbAndroidPresent() {
  const io = await run("/usr/sbin/ioreg", ["-p", "IOUSB", "-l", "-w0"], 5000);
  return PHONE_HINTS.test((io.match(/"USB (?:Product|Vendor) Name" = "[^"]+"/g) || []).join("|"));
}
// Installed-but-not-booted emulators/simulators (AVDs change rarely - refresh lazily).
function refreshEmulators(force) {
  if (!daemon.proc) return;
  if (!force && Date.now() - daemon.emulatorsAt < 60000) return;
  daemon.emulatorsAt = Date.now();
  rpc(daemon, "emulator.getEmulators").then((list) => { daemon.emulators = Array.isArray(list) ? list : []; }).catch(() => {});
}
const pubDevice = (d) => ({
  id: d.id, name: d.name || d.id, platform: d.platform || "", platformType: d.platformType || "",
  emulator: !!d.emulator, emulatorId: d.emulatorId || "", category: d.category || "",
  connected: d.isConnected !== false, // paired wireless devices can be temporarily unreachable
});

// ---- app runs (one per project, like previews) ----
const runs = {}; // base slug -> { proc, deviceId, deviceName, mode, appId, phase, progress, logs, nextId, pending, startedAt }

function killTree(proc) {
  if (!proc) return;
  try { process.kill(-proc.pid, "SIGTERM"); } catch {}
  try { process.kill(proc.pid, "SIGTERM"); } catch {}
}
function appendLog(r, s) { r.logs = (r.logs + s).slice(-200000); }

function startRun(proj, device, mode) {
  const slug = proj.session;
  const proc = spawnFlutter(["run", "--machine", "--" + mode, "-d", device.id], { cwd: proj.path, detached: true, env: cleanEnv() });
  const r = {
    proc, deviceId: device.id, deviceName: device.name || device.id, mode,
    appId: null, phase: "starting", progress: "Launching…", logs: "", nextId: 1, pending: new Map(), startedAt: Date.now(),
  };
  runs[slug] = r;
  proc.stdout.on("data", splitter((line) => {
    if (runs[slug] !== r) return;
    const m = parseMsg(line);
    if (!m) { appendLog(r, line + "\n"); return; } // stray non-machine output (rare) - keep it visible
    if (settleRpc(r, m)) return;
    if (m.event === "app.start") { if (m.params && m.params.appId) r.appId = m.params.appId; }
    else if (m.event === "app.progress") {
      const p = m.params || {};
      // Tool phases (Launching, Installing APK, Gradle/Xcode build...) go into the log
      // too, marked "»" so the client's app-only filter can keep them alongside Dart output.
      if (!p.finished && p.message) { r.progress = p.message; appendLog(r, "» " + p.message + "\n"); }
    }
    else if (m.event === "app.started") { r.phase = "running"; r.progress = ""; appendLog(r, "» App started\n"); }
    else if (m.event === "app.log") { const p = m.params || {}; if (p.log) appendLog(r, p.log + (p.log.endsWith("\n") ? "" : "\n")); }
  }));
  proc.stderr.on("data", (d) => { if (runs[slug] === r) appendLog(r, d.toString()); });
  proc.on("error", (e) => { if (runs[slug] === r) { r.phase = "stopped"; r.appId = null; appendLog(r, "error: " + e.message + "\n"); } });
  proc.on("close", (code) => {
    if (runs[slug] !== r) return;
    // Keep the stopped entry (phase "stopped") so a failed launch's logs stay
    // readable in the UI; the next run or an explicit stop clears it.
    r.phase = "stopped"; r.appId = null;
    rejectAll(r, "app exited");
    appendLog(r, `\n[flutter run exited: ${code}]\n`);
  });
  return r;
}
async function stopRun(slug) {
  const r = runs[slug];
  if (!r) return;
  delete runs[slug];
  rejectAll(r, "stopped");
  // Graceful first - app.stop detaches/uninstalls cleanly; then make sure the tree dies.
  if (r.appId && r.proc.exitCode == null) {
    try { await Promise.race([rpc(r, "app.stop", { appId: r.appId }, 5000), new Promise((res) => setTimeout(res, 5000))]); } catch {}
  }
  killTree(r.proc);
}
function runInfo(r) {
  if (!r) return { running: false };
  const stopped = r.phase === "stopped";
  return {
    running: !stopped, exited: stopped, phase: r.phase, progress: r.progress,
    deviceId: r.deviceId, deviceName: r.deviceName, mode: r.mode, hasApp: !!r.appId,
    logs: r.logs, startedAt: r.startedAt,
  };
}

// Kill the run of a deleted project (fire-and-forget from the DELETE route).
export function stopMobileRun(slug) { stopRun(slug); }

// On shutdown kill every run + the daemon. index.js's SIGINT/SIGTERM handlers call
// process.exit(0), which fires "exit" - killTree/kill are synchronous, so this works there.
export function stopAllMobile() {
  for (const slug of Object.keys(runs)) { const r = runs[slug]; delete runs[slug]; killTree(r.proc); }
  // The group, not just the leader: an orphaned adb/xcdevice child would otherwise
  // outlive the server and go on holding devices open.
  if (daemon.proc) { const d = daemon.proc; daemon.proc = null; try { process.kill(-d.pid, "SIGTERM"); } catch {} try { d.kill("SIGTERM"); } catch {} }
}
process.on("exit", stopAllMobile);

export function registerMobile(app, ctx) {
  const { authed, projectForSession, baseSession, loadProjects, saveProjects } = ctx;

  // Everything the run menu needs in one poll: project kind, live devices, cold
  // emulators, and the current run. `probe=1` answers "is this a Flutter project?"
  // without waking the daemon.
  app.get("/api/mobile/status", (req, res) => {
    if (!authed(req)) return res.sendStatus(401);
    const proj = projectForSession(req.query.session);
    if (!proj) return res.status(404).json({ error: "unknown project" });
    const flutter = isFlutterProject(proj.path);
    const available = flutter ? !!flutterBin() : false;
    if (!flutter || !available || req.query.probe === "1")
      return res.json({ flutter, available, devices: [], emulators: [], run: runInfo(runs[baseSession(req.query.session)]) });
    ensureDaemon();
    const running = !!runs[baseSession(req.query.session)];
    recycleDaemon(running);
    if (!running) watchDevices();   // fire-and-forget; only runs while a dock is watching
    refreshEmulators();
    refreshDevices();
    const devices = [...daemon.devices.values()].map(pubDevice);
    // Hide emulators that are already booted (their running device carries emulatorId).
    const booted = new Set(devices.map((d) => d.emulatorId).filter(Boolean));
    const emulators = daemon.emulators
      .filter((e) => e && e.id && !booted.has(e.id))
      .map((e) => ({ id: e.id, name: e.name || e.id, platformType: e.platformType || "" }));
    res.json({
      flutter, available, daemon: !!daemon.proc, devices, emulators,
      run: runInfo(runs[baseSession(req.query.session)]),
      device: proj.mobileDevice || "", mode: proj.mobileMode || "debug",
    });
  });

  // Manual repair valve behind the dock's rescan button. Everything above exists so this
  // is never needed, but a device list that has gone stale with no way out is far worse
  // than a button that rarely gets pressed - and it doubles as "I just plugged something
  // in and don't want to wait for the watcher".
  app.post("/api/mobile/refresh", async (req, res) => {
    if (!authed(req)) return res.sendStatus(401);
    if (FLUTTER_BIN === null) FLUTTER_BIN = undefined;   // maybe they've installed it since
    if (!flutterBin()) return res.status(400).json({ error: "flutter not found on this machine" });
    const ok = await resetDaemon();
    if (!ok) return res.status(500).json({ error: "could not start the flutter daemon" });
    const devices = [...daemon.devices.values()].map(pubDevice);
    let hint = "";
    if (!isWin && !devices.some((d) => d.platformType === "android" && !d.emulator) && await usbAndroidPresent())
      hint = "A phone is plugged in over USB but isn't exposing ADB. Turn on USB debugging (Developer options), accept the prompt on the phone, then rescan.";
    res.json({ ok: true, daemon: !!daemon.proc, devices, hint });
  });

  app.post("/api/mobile/run", async (req, res) => {
    if (!authed(req)) return res.sendStatus(401);
    const projects = loadProjects();
    const proj = projects.find((p) => p.session === baseSession(req.body.session));
    if (!proj) return res.status(404).json({ error: "unknown project" });
    if (!isFlutterProject(proj.path)) return res.status(400).json({ error: "not a Flutter project" });
    if (!flutterBin()) return res.status(400).json({ error: "flutter not found on this machine" });
    const mode = ["debug", "profile", "release"].includes(req.body.mode) ? req.body.mode : "debug";
    const device = daemon.devices.get(String(req.body.deviceId || ""));
    if (!device || device.isConnected === false) return res.status(400).json({ error: "device not connected" });
    proj.mobileDevice = device.id; proj.mobileMode = mode; saveProjects(projects); // remembered as next time's default
    await stopRun(proj.session);
    startRun(proj, device, mode);
    // Give the launch a beat so an instant failure (bad target, broken pubspec)
    // comes back in this response instead of an empty "starting" card.
    await new Promise((r2) => setTimeout(r2, 1200));
    res.json({ ok: true, run: runInfo(runs[proj.session]) });
  });

  // Hot reload / hot restart - the same RPC with fullRestart flipped.
  const restart = (fullRestart) => async (req, res) => {
    if (!authed(req)) return res.sendStatus(401);
    const r = runs[baseSession(req.body.session)];
    if (!r || !r.appId) return res.status(400).json({ error: "app not running" });
    try {
      const out = await rpc(r, "app.restart", { appId: r.appId, fullRestart, reason: "manual", pause: false }, 120000);
      res.json({ ok: !out || out.code === 0, message: (out && out.message) || "" });
    } catch (e) { res.status(500).json({ error: String((e && e.message) || e) }); }
  };
  app.post("/api/mobile/reload", restart(false));
  app.post("/api/mobile/restart", restart(true));

  app.post("/api/mobile/stop", async (req, res) => {
    if (!authed(req)) return res.sendStatus(401);
    await stopRun(baseSession(req.body.session));
    res.json({ ok: true });
  });

  // Boot a cold emulator/simulator. The daemon's reply can lag until the emulator
  // process is up - don't hold the request past a few seconds; the booted device
  // then shows up in the list by itself via device.added.
  app.post("/api/mobile/emulator", async (req, res) => {
    if (!authed(req)) return res.sendStatus(401);
    if (!ensureDaemon()) return res.status(400).json({ error: "flutter not available" });
    const id = String(req.body.id || "");
    if (!id) return res.status(400).json({ error: "no emulator id" });
    try {
      await Promise.race([rpc(daemon, "emulator.launch", { emulatorId: id }, 20000), new Promise((r2) => setTimeout(r2, 8000))]);
      res.json({ ok: true, booting: true });
    } catch (e) { res.status(500).json({ error: String((e && e.message) || e) }); }
  });
}
