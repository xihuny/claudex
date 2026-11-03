import { useEffect, useState, useCallback, useRef } from "react";
import { Globe, Copy, Square, RotateCw, ExternalLink, Loader2, Monitor, Zap, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { api } from "@/lib/api";
import { useStore } from "@/store/store";
import { cn } from "@/lib/utils";
import { MobileRunPoller } from "@/components/MobileRunPoller";

interface DevStatus {
  command: string; port: number; available: boolean;
  domain: string; name: string; defaultName: string;   // named-tunnel mode (empty domain = quick tunnels)
  running: boolean; local: boolean; url: string; lanUrl: string; logs: string;
}
interface PortInfo { port: number; inUse: boolean; holder: { pid: number; name: string } | null; suggested: number; }

// "Local" runs are amber/honey (private, on-machine); "Public" runs are the brand green.
const LOCAL = { text: "text-warn", bg: "bg-warn/15", ring: "border-warn/40", dot: "bg-warn" };
const PUBLIC = { text: "text-accent", bg: "bg-accent/15", ring: "border-accent/40", dot: "bg-accent" };

// The run button adapts to the project: Flutter projects get the device runner
// (MobileRunDock, fed by MobileRunPoller), everything else keeps the dev-server + tunnel menu. One cheap
// probe per project (a pubspec check server-side), cached for the app's lifetime.
const projectKind = new Map<string, boolean>(); // slug -> isFlutter

export function TunnelMenu() {
  const active = useStore((s) => s.active);
  const base = (active || "").split("::")[0];
  const [flutter, setFlutter] = useState<boolean | null>(() => (base && projectKind.has(base) ? projectKind.get(base)! : null));
  useEffect(() => {
    if (!base) { setFlutter(null); return; }
    if (projectKind.has(base)) { setFlutter(projectKind.get(base)!); return; }
    let dead = false;
    setFlutter(null);
    api<{ flutter: boolean }>("GET", `/api/mobile/status?session=${encodeURIComponent(base)}&probe=1`)
      .then((r) => { projectKind.set(base, !!r.flutter); if (!dead) setFlutter(!!r.flutter); })
      .catch(() => { if (!dead) setFlutter(false); });
    return () => { dead = true; };
  }, [base]);
  if (flutter) return <MobileRunPoller />; // headless: the Flutter controls live in the bottom bar
  return <WebRunMenu />; // default (and while probing) - the web menu is today's behavior
}

function WebRunMenu() {
  const active = useStore((s) => s.active);
  const projectBySlug = useStore((s) => s.projectBySlug);
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<DevStatus | null>(null);
  const [cmd, setCmd] = useState("");
  const [pubName, setPubName] = useState("");
  const [portMode, setPortMode] = useState<"auto" | "custom">("auto");
  const [port, setPort] = useState("");
  const [info, setInfo] = useState<PortInfo | null>(null);   // live port inspection
  const [checking, setChecking] = useState(false);
  const [killing, setKilling] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!active) { setSt(null); return null; }
    try { const r = await api<DevStatus>("GET", "/api/dev/status?session=" + encodeURIComponent(active)); setSt(r); return r; }
    catch { return null; }
  }, [active]);

  useEffect(() => { refresh(); const i = setInterval(refresh, open ? 3500 : 12000); return () => clearInterval(i); }, [refresh, open]);
  useEffect(() => { if (open) (async () => { const r = await refresh(); if (r) { setCmd(r.command); setPubName(r.name || ""); setPort(String(r.port)); setPortMode("auto"); } })(); }, [open]); // eslint-disable-line

  // Inspect the chosen port (or the auto base) - debounced - to drive the inline status
  // and the "auto will start on :N" preview. Skipped while a server is already running.
  const checkPort = useCallback(async (p: string, base: string) => {
    setChecking(true);
    try { setInfo(await api<PortInfo>("GET", `/api/dev/port?port=${Number(p) || 0}&base=${Number(base) || 3000}`)); }
    catch { setInfo(null); } finally { setChecking(false); }
  }, []);
  const liveRef = useRef(false);
  useEffect(() => { liveRef.current = !!st?.running; });
  useEffect(() => {
    if (!open || liveRef.current) return;
    const id = setTimeout(() => checkPort(portMode === "custom" ? port : "", portMode === "custom" ? port : "3000"), 300);
    return () => clearTimeout(id);
  }, [open, portMode, port, checkPort, st?.running]);

  async function act(path: string, label: string, body?: unknown) {
    setBusy(true);
    const id = toast.loading(label);
    try {
      const r = await api<any>("POST", "/api/dev/" + path, body);
      if (!r.running) toast.success("Stopped", { id });
      else if (r.local) toast.success(`Running locally on :${r.port}`, { id });
      else toast.success(r.url ? "Public link ready" : "Exposing… link in a few seconds", { id });
    } catch (e) { toast.error((e as Error).message, { id }); }
    finally { setBusy(false); refresh(); }
  }

  async function freePort() {
    setKilling(true);
    const id = toast.loading(`Freeing port ${port}…`);
    try {
      const r = await api<any>("POST", "/api/dev/kill-port", { port: Number(port) });
      if (r.freed) toast.success(`Port ${port} freed`, { id });
      else toast.error(r.reason || "Couldn't free the port", { id });
      await checkPort(port, port);
    } catch (e) { toast.error((e as Error).message, { id }); }
    finally { setKilling(false); }
  }

  const live = !!st?.running;
  const isLocal = !!st?.local;
  const tone = isLocal ? LOCAL : PUBLIC;
  const copy = (u: string) => { navigator.clipboard.writeText(u); toast.success("Link copied"); };
  const urls: [string, string][] = live
    ? isLocal
      ? [["Mac", st!.url], ...(st!.lanUrl ? [["Wi-Fi", st!.lanUrl] as [string, string]] : [])]
      : st!.url ? [["Public", st!.url]] : []
    : [];

  // Inline status for the custom port field.
  const customBusy = portMode === "custom" && !!port && info?.port === Number(port) && info?.inUse;
  const blockStart = busy || !active || customBusy;

  return (
    <>
      <button
        onClick={() => active && setOpen(true)} disabled={!active}
        title={live ? (isLocal ? "Dev server running locally" : "Dev server public") : "Run this project"}
        className={cn("grid place-items-center w-9 h-9 rounded-lg transition-colors disabled:opacity-40",
          live ? tone.text : "text-muted hover:text-fg")}
      >
        <Globe size={20} />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Run project" subtitle={active ? projectBySlug(active)?.name : ""}>
        <div className="grid gap-3.5">
          <Field label="Dev command">
            <Input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="pnpm dev" spellCheck={false} className="font-mono text-[13px]" disabled={live} />
          </Field>

          {/* Public name - only in named-tunnel mode. Saved with the project; the
              preview URL is https://<name>.<domain>, stable across restarts. */}
          {!!st?.domain && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Public name</span>
                {pubName !== st.defaultName && !live && (
                  <button onClick={() => setPubName(st.defaultName)}
                    className="text-[11px] text-muted hover:text-fg transition-colors">
                    Reset to default
                  </button>
                )}
              </div>
              <div className="flex items-center gap-0 h-11 rounded-lg bg-bg border border-border overflow-hidden focus-within:border-muted/60">
                <input
                  value={pubName}
                  onChange={(e) => setPubName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder={st.defaultName} spellCheck={false} disabled={live}
                  className="flex-1 min-w-0 h-full px-3.5 bg-transparent outline-none font-mono text-[13px] text-fg placeholder:text-muted/50 disabled:opacity-40"
                />
                <span className="pr-3.5 font-mono text-[13px] text-muted shrink-0">.{st.domain}</span>
              </div>
              {!!pubName && !pubName.startsWith("dev-") && (
                <p className="flex items-center gap-1.5 text-[11px] text-warn px-0.5">
                  <AlertTriangle size={12} className="shrink-0" />
                  Without the <code className="font-mono">dev-</code> prefix the name can collide with a real subdomain.
                </p>
              )}
            </div>
          )}

          {/* Port: auto (next free) by default; switch to custom to target a specific one. */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Port</span>
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-bg border border-border">
                {(["auto", "custom"] as const).map((m) => (
                  <button key={m} disabled={live} onClick={() => setPortMode(m)}
                    className={cn("px-2.5 h-6 rounded-md text-[11px] font-medium capitalize transition-colors disabled:opacity-40",
                      portMode === m ? "bg-panel2 text-fg shadow-sm" : "text-muted hover:text-fg")}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {portMode === "auto" ? (
              <div className="flex items-center gap-2 h-11 px-3.5 rounded-xl bg-bg border border-border text-[13px]">
                <Zap size={14} className="text-accent shrink-0" />
                <span className="text-muted">Starts on the first free port</span>
                {info?.suggested != null && (
                  <span className="ml-auto font-mono text-fg shrink-0">:{info.suggested}</span>
                )}
              </div>
            ) : (
              <>
                <Input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} placeholder="3000" inputMode="numeric" disabled={live} className="font-mono" />
                <PortStatus port={port} info={info} checking={checking} killing={killing} onFree={freePort} />
              </>
            )}
          </div>
        </div>

        {live && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[12px]">
              <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-md font-medium whitespace-nowrap", tone.bg, tone.text)}>
                {isLocal ? <Monitor size={12} /> : <Globe size={12} />}{isLocal ? "Local" : "Public"}
              </span>
              <span className="text-muted truncate">{isLocal ? "On this machine only" : "Reachable from anywhere"}</span>
              {st?.port != null && <span className="ml-auto font-mono text-muted shrink-0">:{st.port}</span>}
            </div>
            {urls.map(([tag, u]) => (
              <div key={u} className={cn("flex items-center gap-2 p-2 rounded-xl bg-bg border", tone.ring)}>
                <ExternalLink size={14} className={cn("shrink-0", tone.text)} />
                <span className="text-[12px] text-muted shrink-0 whitespace-nowrap">{tag}</span>
                <a href={u} target="_blank" className="flex-1 text-[12px] text-accent2 truncate font-mono">{u.replace(/^https?:\/\//, "")}</a>
                <button onClick={() => copy(u)} title="Copy link" className="grid place-items-center w-6 h-6 rounded-md text-muted hover:text-fg hover:bg-panel shrink-0"><Copy size={13} /></button>
              </div>
            ))}
            {!isLocal && !st!.url && <p className="text-[11px] text-muted">Tunnel registering, link appears in a few seconds.</p>}
            {isLocal && !st!.lanUrl && <p className="text-[11px] text-muted leading-relaxed">Wi-Fi access needs the dev server bound to all interfaces (e.g. Vite <code className="font-mono">--host</code>).</p>}
          </div>
        )}

        {live && st?.logs && (
          <pre className="mt-3 max-h-28 overflow-auto rounded-xl bg-bg border border-border p-2.5 text-[11px] font-mono text-muted whitespace-pre-wrap">{st.logs.trim() || "…"}</pre>
        )}

        <div className="flex gap-2 mt-5 pt-4 border-t border-border -mx-5 px-5">
          {!live ? (
            <>
              <Button variant="soft" className="flex-1" disabled={blockStart}
                title={customBusy ? "Port in use, free it or pick another" : ""}
                onClick={() => act("start", "Starting locally…", { session: active, command: cmd, local: true, ...(portMode === "custom" && port ? { port: Number(port) } : { auto: true }) })}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Monitor size={16} />} Run locally
              </Button>
              <Button className="flex-1" disabled={blockStart || (st != null && !st.available)} title={st && !st.available ? "Install cloudflared: brew install cloudflared" : customBusy ? "Port in use, free it or pick another" : ""}
                onClick={() => act("start", "Starting & exposing…", { session: active, command: cmd, ...(st?.domain ? { name: pubName } : {}), ...(portMode === "custom" && port ? { port: Number(port) } : { auto: true }) })}>
                <Globe size={16} /> Expose
              </Button>
            </>
          ) : (
            <>
              <Button variant="soft" className="flex-1" disabled={busy} onClick={() => act("restart", "Restarting…", { session: active })}><RotateCw size={15} /> Restart</Button>
              <Button variant="danger" className="flex-1" disabled={busy} onClick={() => act("stop", "Stopping…", { session: active })}><Square size={14} /> Stop</Button>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

// Inline status under the custom port field: free / in use (with what holds it + a way
// to free it) / checking. Kept to a single line so nothing wraps awkwardly.
function PortStatus({ port, info, checking, killing, onFree }: {
  port: string; info: PortInfo | null; checking: boolean; killing: boolean; onFree: () => void;
}) {
  if (!port) return <p className="text-[11px] text-muted px-0.5">Enter a port number.</p>;
  const fresh = info?.port === Number(port);
  if (checking && !fresh) return <p className="flex items-center gap-1.5 text-[11px] text-muted px-0.5"><Loader2 size={11} className="animate-spin" /> Checking…</p>;
  if (!fresh) return null;
  if (!info!.inUse) return <p className="flex items-center gap-1.5 text-[11px] text-accent px-0.5"><Check size={12} /> Port {port} is free</p>;
  return (
    <div className="flex items-center gap-2 px-0.5">
      <p className="flex items-center gap-1.5 text-[11px] text-warn min-w-0">
        <AlertTriangle size={12} className="shrink-0" />
        <span className="truncate">In use by <b className="font-medium">{info!.holder?.name}</b><span className="text-muted"> · pid {info!.holder?.pid}</span></span>
      </p>
      <button onClick={onFree} disabled={killing}
        className="ml-auto shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-medium text-danger border border-danger/30 hover:bg-danger/10 transition-colors disabled:opacity-40">
        {killing ? <Loader2 size={11} className="animate-spin" /> : <Square size={10} />} Free it
      </button>
    </div>
  );
}
