import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, m as motion } from "motion/react";
import { Activity, Flame } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Win { utilization: number; resets_at: string | null; }
interface Scope { model?: { id: string | null; display_name: string } | null; surface?: string | null; }
interface Limit { kind: string; group: string; percent: number; severity: string; resets_at: string | null; is_active: boolean; scope?: Scope | null; }
interface Usage { available: boolean; reason?: string; five_hour?: Win; seven_day?: Win; limits?: Limit[]; }
interface KeepWarm { enabled: boolean; nextAnchorAt: number | null; lastAnchor: { ok: boolean; at: number; error?: string; resetsAt?: number } | null; }

function until(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${m % 60}m`;
  return `${m}m`;
}
// Absolute reset moment, e.g. "Fri 11:59 PM" - the countdown says how long, this says when.
function resetAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const day = d.toLocaleDateString([], { weekday: "short" });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\b(am|pm)\b/i, (s) => s.toUpperCase());
  return `${day} ${time}`;
}
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\b(am|pm)\b/i, (s) => s.toUpperCase());
const tone = (p: number) => (p >= 90 ? "text-danger" : p >= 70 ? "text-warn" : "text-fg");
const barTone = (p: number) => (p >= 90 ? "bg-danger" : p >= 70 ? "bg-warn" : "bg-accent");
const LABELS: Record<string, string> = {
  session: "Session · 5 hours", weekly_all: "Weekly (all models)",
  weekly_opus: "Weekly · Opus", weekly_sonnet: "Weekly · Sonnet", weekly_oauth_apps: "Weekly · apps",
};
// weekly_scoped names its model in `scope` rather than in the kind, so its label is
// derived, not looked up - one kind covers every per-model weekly limit.
function labelFor(l: Limit): string | null {
  if (l.kind === "weekly_scoped") {
    const m = l.scope?.model?.display_name;
    return m ? `Weekly · ${m}` : "Weekly · scoped";
  }
  return LABELS[l.kind] || null;
}
const rowKey = (l: Limit) => (l.kind === "weekly_scoped" ? `${l.kind}:${l.scope?.model?.display_name ?? "?"}` : l.kind);

export function UsagePill() {
  const [u, setU] = useState<Usage | null>(null);
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const [kw, setKw] = useState<KeepWarm | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => { try { setU(await api<Usage>("GET", "/api/usage")); } catch {} }, []);
  useEffect(() => { refresh(); const i = setInterval(refresh, 200000); return () => clearInterval(i); }, [refresh]);
  // Poll while the panel is open so the status line (next-window time / errors) stays live
  // as the server anchors in the background - not just on reopen.
  useEffect(() => {
    if (!open) return;
    const load = () => api<KeepWarm>("GET", "/api/usage/keepwarm").then(setKw).catch(() => {});
    load();
    const i = setInterval(load, 8000);
    return () => clearInterval(i);
  }, [open]);
  const toggleKw = async () => {
    const next = !kw?.enabled;
    setKw((k) => ({ enabled: next, nextAnchorAt: k?.nextAnchorAt ?? null, lastAnchor: k?.lastAnchor ?? null }));
    try { setKw(await api<KeepWarm>("POST", "/api/usage/keepwarm", { enabled: next })); } catch {}
  };
  useEffect(() => { const i = setInterval(() => setTick((t) => t + 1), 30000); return () => clearInterval(i); }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!u?.available) return null;
  const u5 = Math.round(u.five_hour?.utilization ?? 0);
  const u7 = Math.round(u.seven_day?.utilization ?? 0);
  const rows = (u.limits || []).filter((l) => labelFor(l) && (l.is_active || l.percent > 0 || l.kind === "session" || l.kind === "weekly_all"));

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} title="Claude usage"
        className={cn("flex items-center gap-1.5 h-7 px-2 rounded-lg text-[11px] transition-colors shrink-0",
          open ? "bg-panel2 text-fg" : "text-muted hover:bg-panel2 hover:text-fg")}>
        <Activity size={13} className="shrink-0" />
        <span className="hidden sm:inline">5h</span>
        <b className={cn("font-semibold", tone(u5))}>{u5}%</b>
        <span className="hidden sm:flex items-center gap-1.5"><span className="text-border">·</span>wk <b className={cn("font-semibold", tone(u7))}>{u7}%</b></span>
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
              // Mobile: pin within the viewport - full width minus side margins, just
              // below the topbar - so the panel is never clipped off-screen.
              "fixed left-3 right-3 top-[calc(52px+env(safe-area-inset-top)+8px)]",
              // Desktop: anchored dropdown under the pill.
              "md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:w-[min(300px,calc(100vw-24px))]",
            )}
          >
            <div className="flex items-center gap-2 px-3.5 pt-3 pb-2.5 border-b border-border">
              <Activity size={15} className="text-accent" />
              <span className="text-[13px] font-semibold">Claude usage</span>
            </div>
            <div className="p-3.5 flex flex-col gap-3.5">
              {rows.length === 0 && <p className="text-[12.5px] text-muted">No active limits reported.</p>}
              {rows.map((l) => {
                const p = Math.round(l.percent);
                return (
                  <div key={rowKey(l)}>
                    <div className="flex items-center justify-between text-[12px] mb-1.5">
                      <span className="font-medium">{labelFor(l)}</span>
                      <span className={cn("tabular-nums", tone(p))}>{p}%{l.resets_at && <span className="text-muted font-normal"> · {until(l.resets_at)}</span>}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-bg overflow-hidden">
                      <motion.div className={cn("h-full rounded-full", barTone(p))} initial={{ width: 0 }} animate={{ width: `${Math.min(100, p)}%` }} transition={{ type: "spring", stiffness: 200, damping: 26 }} />
                    </div>
                    {l.resets_at && <div className="mt-1 text-[12px] text-muted">Resets {resetAt(l.resets_at)}</div>}
                  </div>
                );
              })}

              <div className="mt-0.5 pt-3 border-t border-border">
                <button onClick={toggleKw} className="w-full flex items-start gap-2.5 text-left group">
                  <Flame size={16} className={cn("mt-0.5 shrink-0", kw?.enabled ? "text-warn" : "text-muted")} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium">Auto-renew session</div>
                    <div className="text-[11px] text-muted leading-snug">
                      {kw?.enabled
                        ? (kw.lastAnchor && !kw.lastAnchor.ok
                            ? <span className="text-danger">⚠ {kw.lastAnchor.error}</span>
                            : kw.nextAnchorAt ? <>Next window opens ~{clock(kw.nextAnchorAt)}</> : "Checking usage…")
                        : "Opens the next window the instant one resets"}
                    </div>
                  </div>
                  <span className={cn("relative shrink-0 mt-0.5 w-8 h-[18px] rounded-full transition-colors", kw?.enabled ? "bg-accent" : "bg-border")}>
                    <span className={cn("absolute top-0.5 left-0.5 w-[14px] h-[14px] rounded-full bg-white transition-transform", kw?.enabled && "translate-x-[14px]")} />
                  </span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
