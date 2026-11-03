import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Zap, RotateCw, Square, Loader2, ChevronDown, ChevronUp, X, Play, Smartphone, Laptop, Globe, Bug, Gauge, Rocket, Check } from "lucide-react";
import { useStore } from "@/store/store";
import { useMobileRun, sortDevices, type MDevice, type Mode } from "@/store/mobileRun";
import { cn } from "@/lib/utils";

// Always-on Flutter bar under the chat/terminal pane (above the KeyBar). Idle: device
// picker (dropdown, not a dialog), mode switch and Run. Running: status, logs toggle and
// hot reload/restart/stop, with the device/mode controls hidden until Stop.
// MobileRunPoller feeds the store.

const MODES: { id: Mode; label: string; icon: typeof Bug }[] = [
  { id: "debug", label: "Debug", icon: Bug },
  { id: "profile", label: "Profile", icon: Gauge },
  { id: "release", label: "Release", icon: Rocket },
];

function deviceIcon(d: MDevice) {
  if (d.platformType === "macos" || d.platformType === "windows" || d.platformType === "linux") return Laptop;
  if (d.platformType === "web") return Globe;
  return Smartphone;
}
function deviceSub(d: MDevice) {
  if (d.connected === false) return "Unavailable";
  if (d.emulator) return d.platformType === "ios" ? "Simulator" : "Emulator";
  if (d.platformType === "android" || d.platformType === "ios") return d.platformType === "ios" ? "iOS device" : "Android device";
  return d.platformType || d.platform || "device";
}

export function MobileRunDock() {
  const active = useStore((s) => s.active);
  const slug = useMobileRun((s) => s.slug);
  const st = useMobileRun((s) => s.st);
  const sel = useMobileRun((s) => s.sel);
  const mode = useMobileRun((s) => s.mode);
  const booting = useMobileRun((s) => s.booting);
  const logsOpen = useMobileRun((s) => s.logsOpen);
  const busy = useMobileRun((s) => s.busy);
  const acting = useMobileRun((s) => s.acting);
  const rescanning = useMobileRun((s) => s.rescanning);
  const { setSel, setMode, toggleLogs, runApp, boot, act, rescan } = useMobileRun.getState();
  const logRef = useRef<HTMLPreElement>(null);
  const pinned = useRef(true); // follow the tail unless the user scrolled up
  const [height, setHeight] = useState(() => Number(localStorage.getItem("cx_runlogs_h")) || 200);
  // "App only" (default) keeps what matters for the app itself: Dart output (print/
  // debugPrint/exception blocks arrive prefixed "flutter:"), tool phases the server marks
  // with "»" (Launching, Installing, build steps), and any error-ish line from the device
  // (uncaught exceptions, native crashes, stack frames). Device/system chatter needs "All".
  const [appOnly, setAppOnly] = useState(() => localStorage.getItem("cx_runlogs_app") !== "0");

  const run = st?.run;
  const raw = run?.logs || "";
  const logs = appOnly
    ? raw.split("\n").filter((l) => /(^|\s|\/)flutter\s*:|^»|^\[flutter run exited|\b(Exception|Error|FATAL|Terminating|Unhandled|Assertion|failed)\b|^\s*#\d+\s|^\s+at\s|^[EF]\/|══/i.test(l)).join("\n")
    : raw;

  // Drag the divider to resize the log pane (pointer events cover mouse + touch).
  function startResize(e: ReactPointerEvent) {
    e.preventDefault();
    const y0 = e.clientY, h0 = height;
    const move = (ev: PointerEvent) => setHeight(Math.max(80, Math.min(window.innerHeight * 0.7, h0 + (y0 - ev.clientY))));
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      setHeight((h) => { localStorage.setItem("cx_runlogs_h", String(Math.round(h))); return h; });
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  useEffect(() => {
    const el = logRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [logs, logsOpen]);

  if (!st || !st.flutter || slug !== active) return null;

  const live = !!run?.running;
  const starting = live && run?.phase === "starting";
  const canReload = live && run?.mode === "debug" && !!run?.hasApp;
  const canRestart = live && (run?.mode === "debug" || run?.mode === "profile") && !!run?.hasApp;
  const showHot = live && run?.mode !== "release";
  const devices = sortDevices(st.devices);
  const dev = devices.find((d) => d.id === sel);
  const hasLogs = !!run && (live || !!run.exited);

  const iconBtn = (label: string, on: () => void, Icon: typeof Zap, opts: { disabled?: boolean; busy?: boolean; cls?: string; title?: string }) => (
    <button onClick={on} disabled={opts.disabled || !!acting} title={opts.title || label} aria-label={label}
      className={cn("grid place-items-center w-8 h-8 rounded-lg transition-colors disabled:opacity-35", opts.cls)}>
      {opts.busy ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
    </button>
  );

  return (
    <div className="shrink-0 border-t border-border bg-panel flex flex-col">
      <div className="flex items-center gap-1.5 px-2 h-10">
        {!st.available ? (
          <span className="flex-1 text-[11px] text-muted truncate">Flutter isn't on the PATH of the Mac running claudex.</span>
        ) : live ? (
          <>
            {/* Running: status only; the device/mode controls come back after Stop. */}
            <span className={cn("w-2 h-2 rounded-full shrink-0 ml-1", starting ? "bg-warn animate-pulse" : "bg-accent")} />
            <div className="min-w-0 flex-1 flex items-baseline gap-2">
              <span className="text-[12.5px] font-medium truncate">{run?.deviceName}</span>
              <span className="text-[11px] text-muted truncate">{starting ? (run?.progress || "Launching…") : "Running"}</span>
              {run?.mode && <span className="hidden sm:inline text-[11px] px-1.5 py-px rounded-xs bg-panel2 text-muted capitalize">{run.mode}</span>}
            </div>
          </>
        ) : (
          <>
            {/* Idle: device dropdown (remembered / best available), mode switch, Run. */}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="flex items-center gap-2 min-w-0 flex-1 sm:flex-none sm:max-w-[240px] h-8 px-2 rounded-lg hover:bg-panel2 transition-colors text-left">
                  <span className={cn("w-2 h-2 rounded-full shrink-0", dev ? "bg-accent" : "bg-danger")} />
                  {dev ? (() => { const Icon = deviceIcon(dev); return <Icon size={14} className="text-muted shrink-0" />; })() : <Smartphone size={14} className="text-muted shrink-0" />}
                  <span className="min-w-0 flex-1 flex items-baseline gap-1.5">
                    <span className="text-[12.5px] font-medium truncate">{dev ? dev.name : "No device"}</span>
                    <span className="hidden sm:inline text-[11px] text-muted truncate">{dev ? deviceSub(dev) : "connect one or boot an emulator"}</span>
                  </span>
                  <ChevronUp size={13} className="text-muted shrink-0" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="start" side="top" sideOffset={6} collisionPadding={8}
                  className="z-[60] w-[280px] max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-panel2 p-1.5 shadow-2xl">
                  <div className="flex items-center justify-between gap-2 px-2.5 pt-1 pb-1.5">
                    <DropdownMenu.Label className="text-[11px] text-muted">Device</DropdownMenu.Label>
                    {/* Escape hatch: restarts the server's flutter daemon and rebuilds the
                        list. The list keeps itself current, so this is for the day it
                        doesn't - or for skipping the wait after plugging a phone in. */}
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); rescan(); }}
                      disabled={rescanning}
                      title="Rescan for devices (restarts the Flutter daemon)"
                      className="flex items-center gap-1 h-6 px-1.5 rounded-md text-[11px] font-medium text-muted hover:text-fg hover:bg-panel transition-colors disabled:opacity-50"
                    >
                      <RotateCw size={11} className={cn(rescanning && "animate-spin")} />
                      {rescanning ? "Rescanning…" : "Rescan"}
                    </button>
                  </div>
                  {devices.length === 0 && (
                    <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-muted">
                      <Loader2 size={13} className={cn("shrink-0", rescanning && "animate-spin")} />
                      No devices connected. Plug one in, boot an emulator below, or hit Rescan.
                    </div>
                  )}
                  {devices.map((d) => {
                    const Icon = deviceIcon(d);
                    const on = sel === d.id;
                    return (
                      <DropdownMenu.Item key={d.id} disabled={d.connected === false} onSelect={() => setSel(d.id)}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer outline-none data-[highlighted]:bg-panel data-[disabled]:opacity-50">
                        <Icon size={15} className={cn("shrink-0", on ? "text-accent" : "text-muted")} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] truncate">{d.name}</span>
                          <span className="block text-[11px] text-muted truncate">{deviceSub(d)}</span>
                        </span>
                        {on && <Check size={14} className="text-accent shrink-0" />}
                      </DropdownMenu.Item>
                    );
                  })}
                  {st.emulators.length > 0 && (
                    <>
                      <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
                      <DropdownMenu.Label className="px-2.5 pb-1.5 text-[11px] text-muted">Start an emulator</DropdownMenu.Label>
                      {st.emulators.map((em) => {
                        const isBooting = booting[em.id] != null;
                        return (
                          <DropdownMenu.Item key={em.id} disabled={isBooting} onSelect={(e) => { e.preventDefault(); boot(em); }}
                            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer outline-none data-[highlighted]:bg-panel data-[disabled]:opacity-60">
                            <Smartphone size={15} className="text-muted shrink-0" />
                            <span className="flex-1 min-w-0 text-[13px] truncate">{em.name}</span>
                            {isBooting
                              ? <span className="flex items-center gap-1.5 text-[11px] text-warn shrink-0"><Loader2 size={11} className="animate-spin" /> Booting…</span>
                              : <Play size={13} className="text-muted shrink-0" />}
                          </DropdownMenu.Item>
                        );
                      })}
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <div className="hidden sm:block flex-1" />

            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-bg border border-border shrink-0">
              {MODES.map((m) => (
                <button key={m.id} onClick={() => setMode(m.id)} title={m.label}
                  className={cn("flex items-center gap-1 px-2 h-6 rounded-md text-[11px] font-medium transition-colors",
                    mode === m.id ? "bg-panel2 text-fg shadow-sm" : "text-muted hover:text-fg")}>
                  <m.icon size={11} /> <span className="hidden md:inline">{m.label}</span>
                </button>
              ))}
            </div>

            {run?.exited && !live && (
              <span className="hidden sm:inline text-[11px] text-danger shrink-0">Exited</span>
            )}
            {/* With no device the dropdown is a dead end, so the repair button also sits
                in the bar itself - that's the exact moment it's wanted. */}
            {devices.length === 0 && iconBtn("Rescan devices", rescan, RotateCw,
              { busy: rescanning, cls: "text-muted hover:text-fg", title: "Rescan for devices (restarts the Flutter daemon)" })}
          </>
        )}

        {hasLogs && logsOpen && (
          <button onClick={() => setAppOnly((v) => { localStorage.setItem("cx_runlogs_app", v ? "0" : "1"); return !v; })}
            title={appOnly ? "Showing this app's own output. Click to show all logs." : "Showing all logs. Click for app output only."}
            className={cn("h-6 px-1.5 rounded-md text-[11px] font-medium border transition-colors shrink-0",
              appOnly ? "border-transparent bg-panel2 text-fg" : "border-border text-muted hover:text-fg")}>
            {appOnly ? "App only" : "All logs"}
          </button>
        )}
        {hasLogs && (
          <button onClick={toggleLogs} title={logsOpen ? "Hide logs" : "Show logs"}
            className="flex items-center gap-1 h-8 px-2 rounded-lg text-[11px] text-muted hover:text-fg transition-colors shrink-0">
            Logs {logsOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        )}

        {st.available && (live ? (
          <>
            {showHot && iconBtn("Hot reload", () => act("reload", "Hot reload done"), Zap,
              { disabled: !canReload, busy: acting === "reload", cls: "text-warn hover:bg-warn/10", title: run?.mode === "profile" ? "Hot reload needs debug mode" : "Hot reload" })}
            {showHot && iconBtn("Hot restart", () => act("restart", "Hot restart done"), RotateCw,
              { disabled: !canRestart, busy: acting === "restart", cls: "text-accent hover:bg-accent/10" })}
            {iconBtn("Stop", () => act("stop", "Stopped"), Square, { busy: acting === "stop", cls: "text-danger hover:bg-danger/10" })}
          </>
        ) : (
          <>
            {run?.exited && iconBtn("Dismiss", () => act("stop"), X, { busy: acting === "stop", cls: "text-muted hover:text-fg" })}
            <button onClick={runApp} disabled={busy || !dev} title={dev ? `Run on ${dev.name}` : "No device available"} aria-label="Run"
              className="grid place-items-center w-8 h-8 rounded-lg text-accent hover:bg-accent/10 transition-colors disabled:opacity-35 shrink-0">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={16} />}
            </button>
          </>
        ))}
      </div>
      {hasLogs && logsOpen && (
        <>
          <div onPointerDown={startResize} title="Drag to resize"
            className="h-2 -my-0.5 cursor-row-resize touch-none border-t border-border grid place-items-center group">
            <span className="w-8 h-1 rounded-full bg-border group-hover:bg-muted transition-colors" />
          </div>
          <pre ref={logRef} style={{ height }}
            onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
            className="overflow-auto bg-bg px-2.5 py-2 text-[11px] leading-snug font-mono text-muted whitespace-pre-wrap break-words">
            {logs.trim() || (appOnly && raw.trim() ? "No app output yet (system lines hidden)" : "Waiting for output…")}
          </pre>
        </>
      )}
    </div>
  );
}
