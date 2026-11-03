import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, m as motion } from "motion/react";
import { ArrowUpCircle, Loader2, Check, Download } from "lucide-react";
import { toast } from "sonner";
import { api, authHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";

interface UpdateInfo {
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  method?: string;
  updating?: boolean;
}
type Phase = "idle" | "running" | "done" | "error";

export function UpdatePill() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async (force?: boolean) => {
    try { setInfo(await api<UpdateInfo>("GET", `/api/claude/update${force ? "?force=1" : ""}`)); } catch {}
  }, []);
  // Check on mount, then every 30 min - matches the server-side check cache.
  useEffect(() => { refresh(); const i = setInterval(() => refresh(), 30 * 60 * 1000); return () => clearInterval(i); }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const runUpdate = useCallback(async () => {
    if (phase === "running") return;
    setPhase("running"); setLog([]);
    try {
      const r = await fetch("/api/claude/update/run", { method: "POST", headers: { ...authHeaders() } });
      if (!r.ok || !r.body) throw new Error(r.status === 409 ? "An update is already running" : `HTTP ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let done: any = null;
      for (;;) {
        const { done: fin, value } = await reader.read();
        if (fin) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const raw = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!raw.trim()) continue;
          let msg: any; try { msg = JSON.parse(raw); } catch { continue; }
          if (msg.type === "log") setLog((l) => [...l.slice(-200), msg.line]);
          else if (msg.type === "done") done = msg;
        }
      }
      if (done?.ok) {
        setInfo({ current: done.current, latest: done.latest, updateAvailable: done.updateAvailable, method: done.method });
        setPhase("done");
        toast.success(`Claude Code updated to ${done.current ?? "latest"}`);
        // Let the ✓ show briefly, then collapse - the pill hides itself once
        // updateAvailable is false again.
        setTimeout(() => { setOpen(false); setPhase("idle"); refresh(true); }, 2200);
      } else {
        // No toast on failure: the error phase keeps the pill open with the log showing,
        // which says more than a toast can and doesn't time out while you're reading it.
        setPhase("error");
      }
    } catch (e: any) {
      setPhase("error");
      setLog((l) => [...l, "error: " + (e?.message || String(e))]);
    }
  }, [phase, refresh]);

  // Hidden unless an update is available (or a run is in-flight / just finished).
  const visible = !!info?.updateAvailable || phase === "running" || phase === "done";
  if (!visible) return null;

  const Icon = phase === "running" ? Loader2 : phase === "done" ? Check : ArrowUpCircle;
  const label = phase === "running" ? "Updating…" : phase === "done" ? "Updated" : "Update";

  return (
    <div className="relative" ref={ref}>
      {/* mobile: icon only, sized to match the other top-bar icons */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Claude Code update available"
        className={cn("sm:hidden grid place-items-center w-9 h-9 rounded-lg text-accent transition-colors", open && "bg-panel2")}
      >
        <Icon size={20} className={cn(phase === "running" && "animate-spin")} />
      </button>
      {/* desktop: filled accent button (colored at rest) */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Claude Code update available"
        className="hidden sm:flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-semibold bg-accent text-bg hover:bg-accent2 transition-colors shrink-0"
      >
        <Icon size={13} className={cn("shrink-0", phase === "running" && "animate-spin")} />
        <span>{label}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ type: "spring", stiffness: 460, damping: 30 }}
            style={{ transformOrigin: "top right" }}
            className={cn(
              "z-[60] rounded-2xl border border-border bg-panel2 shadow-2xl shadow-black/50 overflow-hidden",
              // Mobile: pin within the viewport (full width minus side margins, just below
              // the topbar) so it can't slide off-screen. Desktop: anchored dropdown.
              "fixed left-3 right-3 top-[calc(52px+env(safe-area-inset-top)+8px)]",
              "md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:w-[min(340px,calc(100vw-24px))]",
            )}
          >
            <div className="flex items-center gap-2 px-3.5 pt-3 pb-2.5 border-b border-border">
              <Download size={15} className="text-muted" />
              <span className="text-[14px] font-semibold">Claude Code update</span>
            </div>
            <div className="p-3.5 flex flex-col gap-3">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-muted">Installed</span>
                <span className="tabular-nums">{info?.current ?? "…"}</span>
              </div>
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-muted">Latest</span>
                <span className="tabular-nums text-accent font-semibold">{info?.latest ?? "…"}</span>
              </div>

              {(phase === "idle" || phase === "running") && (
                <button
                  onClick={runUpdate}
                  disabled={phase === "running"}
                  className="mt-1 h-9 flex items-center justify-center gap-1.5 rounded-lg bg-accent text-bg font-semibold text-[14px] hover:bg-accent2 active:scale-[0.98] transition-all disabled:opacity-60 disabled:pointer-events-none"
                >
                  {phase === "running" && <Loader2 size={14} className="animate-spin" />}
                  {phase === "running" ? "Updating…" : "Update now"}
                </button>
              )}
              {phase === "done" && (
                <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-accent">
                  <Check size={14} /> Updated to {info?.current}
                </div>
              )}
              {phase === "error" && (
                <button
                  onClick={runUpdate}
                  className="mt-1 h-9 rounded-lg bg-panel border border-border text-[14px] font-semibold hover:bg-bg transition-colors"
                >
                  Retry
                </button>
              )}

              {log.length > 0 && (
                <div
                  ref={logRef}
                  className="max-h-40 overflow-auto rounded-lg bg-bg border border-border p-2 font-mono text-[11px] leading-relaxed text-muted whitespace-pre-wrap"
                >
                  {log.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
