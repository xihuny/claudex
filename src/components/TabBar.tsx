import { useEffect, useRef, useState } from "react";
import { m as motion } from "motion/react";
import autoAnimate from "@formkit/auto-animate";
import { X, Plus, Layers, MessageSquare, TerminalSquare, Pencil, Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useStore, baseOf, GENERAL_SLUG } from "@/store/store";
import * as terminals from "@/lib/terminals";
import { createSession, renameSession, destroySession } from "@/lib/sessions";
import { cn } from "@/lib/utils";
import { ProjectContextMenu } from "@/components/ProjectMenu";
import type { Project, SessionMeta } from "@/types";

const SESSION_CAP = 6;
// Stable identity - a fresh literal here would re-render the popover on every store tick.
const GENERAL_ONLY: SessionMeta[] = [{ slug: GENERAL_SLUG, name: "Chat 1" }];

export function TabBar() {
  const openSlugs = useStore((s) => s.openSlugs);
  const active = useStore((s) => s.active);
  const attention = useStore((s) => s.attention);
  const projects = useStore((s) => s.projects);
  const openProject = useStore((s) => s.openProject);
  const openSession = useStore((s) => s.openSession);
  const sessionsOf = useStore((s) => s.sessionsOf);
  const rowRef = useRef<HTMLDivElement>(null);
  // The open popover, anchored at viewport coords (fixed, so the overflow-x-auto tab row
  // can't clip it). null when closed.
  const [popover, setPopover] = useState<{ base: string; x: number; y: number } | null>(null);

  useEffect(() => { if (rowRef.current) autoAnimate(rowRef.current); }, []);

  // Unique project bases in open order - one chip per project, regardless of sessions.
  // The General chat is excluded here; it gets its own pinned launcher (below), not a chip.
  const bases: string[] = [];
  for (const s of openSlugs) { const b = baseOf(s); if (b !== GENERAL_SLUG && !bases.includes(b)) bases.push(b); }

  const generalActive = !!active && baseOf(active) === GENERAL_SLUG;

  return (
    <div className="flex items-center px-2.5 py-1.5 overflow-x-auto no-scrollbar border-b border-border">
      {/* Button + chips center together on desktop, so the launcher always sits directly
          left of the first project chip (not pinned to the far edge of the bar). */}
      <div className="flex items-center gap-1.5 md:mx-auto">
        {/* Always-present launcher for the project-independent General chat - an anchor, not a tab. */}
        <button
          data-session-trigger
          // Same interaction as a project chip: the first tap selects it (returning to the
          // conversation you were last in, not always the first), and tapping it while it's
          // already active opens the chat list.
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (generalActive) {
              setPopover((v) => (v && v.base === GENERAL_SLUG ? null : { base: GENERAL_SLUG, x: r.left, y: r.bottom + 8 }));
            } else {
              setPopover(null);
              openProject(GENERAL_SLUG);
            }
          }}
          title="General chat"
          className={cn(
            "relative shrink-0 w-9 h-9 rounded-md transition-colors",
            generalActive
              ? "text-fg"
              : "text-muted hover:text-fg hover:bg-panel2/60",
          )}
        >
          {/* Same shared-layout underline as the project chips, so switching to/from the
              General launcher slides instead of snapping. */}
          {generalActive && (
            <motion.div
              layoutId="tab-active"
              className="absolute left-2 right-2 -bottom-1.5 h-[2px] rounded-full bg-accent"
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
            />
          )}
          {/* Icon is absolutely centered so its position never depends on the pill or
              border state - no layout shift when the tab becomes active. */}
          <span className="absolute inset-0 z-10 grid place-items-center">
            <Sparkles size={17} />
          </span>
        </button>
        <div ref={rowRef} className="flex gap-1.5">
        {bases.map((base) => {
          const p = projects.find((x) => x.session === base);
          const sessions = sessionsOf(base);
          const multi = sessions.length > 1;
          const isActiveProject = !!active && baseOf(active) === base;
          const showActive = isActiveProject;
          const needsAttention = !isActiveProject && attention.includes(base);   // finished a turn while you were elsewhere
          return (
            <div key={base} className="relative shrink-0">
              {/* First click on an inactive chip just switches to it - no popup. The
                  session popup only opens when you click the chip that's already active
                  (so a single tap never spawns a new pane). A Layers icon marks >1 session. */}
              <MaybeProjectMenu p={p}>
              <div
                data-session-trigger
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  if (isActiveProject) setPopover((v) => (v && v.base === base ? null : { base, x: r.left, y: r.bottom + 8 }));
                  else { setPopover(null); openProject(base); }
                }}
                className={cn(
                  "relative flex items-center gap-1.5 pl-3 pr-1 h-9 rounded-md cursor-pointer text-[14px] transition-colors",
                  showActive ? "text-fg" : "text-muted hover:text-fg hover:bg-panel2/60",
                  needsAttention && !showActive && "text-fg",   // un-dim: a finished-but-unseen project reads as notable
                )}
              >
                {showActive && (
                  <motion.div
                    layoutId="tab-active"
                    className="absolute left-2 right-2 -bottom-1.5 h-[2px] rounded-full bg-accent"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                {needsAttention && (
                  // Calm "check me" cue - a small accent dot that pops in once, then rests.
                  // A steady dot (not a loop) reads as "finished/unseen", not "still working".
                  <motion.span
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 520, damping: 22 }}
                    className="relative z-10 h-1.5 w-1.5 rounded-full bg-accent shrink-0"
                  />
                )}
                <span className="relative z-10 max-w-[140px] truncate">{p?.name ?? base}</span>
                {multi && <Layers size={13} className="relative z-10 shrink-0 text-muted" />}
                <button
                  onClick={(e) => { e.stopPropagation(); setPopover(null); closeProjectTab(base); }}
                  className="relative z-10 grid place-items-center w-6 h-6 rounded-sm text-muted hover:text-danger hover:bg-panel2"
                  title="Close project"
                >
                  <X size={13} />
                </button>
              </div>
              </MaybeProjectMenu>
            </div>
          );
        })}
        </div>
      </div>

      {popover && (
        <SessionPopover
          base={popover.base}
          x={popover.x}
          y={popover.y}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}

// Right-click on a chip opens the sidebar's project menu. A chip can show before its
// project has loaded, so it has no menu until then.
function MaybeProjectMenu({ p, children }: { p: Project | undefined; children: React.ReactNode }) {
  return p ? <ProjectContextMenu p={p}>{children}</ProjectContextMenu> : <>{children}</>;
}

// Close a whole project tab (all its open sessions) - local only; the sessions persist
// server-side and their chat processes idle out, matching single-session tab behaviour.
function closeProjectTab(base: string) {
  const open = useStore.getState().openSlugs.filter((s) => baseOf(s) === base);
  for (const s of open) terminals.dispose(s);
  useStore.getState().closeTab(base);
}

function SessionPopover({ base, x, y, onClose }: {
  base: string; x: number; y: number; onClose: () => void;
}) {
  const active = useStore((s) => s.active);
  const openSession = useStore((s) => s.openSession);
  const mode = useStore((s) => s.mode);
  // General has no entry in `projects` (it's synthetic), so name it explicitly.
  const isGeneral = base === GENERAL_SLUG;
  const projectName = useStore((s) => s.projects.find((p) => p.session === base)?.name) ?? (isGeneral ? "General" : "Main session");
  // General allows more conversations than a project does - they're chats, not workspaces.
  const generalCap = useStore((s) => s.generalCap);
  const cap = isGeneral ? generalCap : SESSION_CAP;
  // Derived here rather than passed in: as a prop it came from TabBar, which doesn't
  // subscribe to generalSessions, so a rename left the popover showing the old name until
  // it was closed and reopened. Both selectors return stable references.
  const generalSessions = useStore((s) => s.generalSessions);
  const projSessions = useStore((s) => s.projects.find((p) => p.session === base)?.sessions);
  const sessions: SessionMeta[] = isGeneral
    ? (generalSessions.length ? generalSessions : GENERAL_ONLY)
    : (projSessions && projSessions.length ? projSessions : [{ slug: base, name: "Session 1" }]);
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest("[data-session-trigger]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  async function addSession() {
    setBusy(true);
    try { await createSession(base); onClose(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function rename(slug: string) {
    const name = draft.trim();
    setRenaming(null);
    if (!name) return;
    try { await renameSession(slug, name); } catch (e) { toast.error((e as Error).message); }
  }
  async function close(slug: string) {
    try { await destroySession(slug); } catch (e) { toast.error((e as Error).message); }
  }

  const width = Math.min(280, window.innerWidth - 24);
  const left = Math.max(12, Math.min(x, window.innerWidth - width - 12));
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 480, damping: 32 }}
      style={{ transformOrigin: "top left", position: "fixed", left, top: y, width }}
      // At rest the entry animation resolves to the identity transform, but motion leaves
      // it on the element - and a transformed ancestor offsets the native text caret, so
      // the rename field drew its cursor outside the box. Clearing it changes nothing
      // visually and puts the caret back where it belongs.
      onAnimationComplete={() => { if (ref.current) ref.current.style.transform = "none"; }}
      className="z-[60] rounded-2xl border border-border bg-panel2 shadow-2xl shadow-black/50 overflow-hidden"
    >
      <div className="px-3.5 pt-3 pb-1.5 text-[12px] text-muted font-medium">{isGeneral ? "Chats" : "Sessions"}</div>
      <div className="px-1.5 pb-1.5 flex flex-col">
        {sessions.map((s) => {
          const on = s.slug === active;
          const isChat = (mode[s.slug] || "chat") === "chat";
          const label = s.slug === base ? projectName : s.name;
          if (renaming === s.slug) {
            return (
              <form key={s.slug} onSubmit={(e) => { e.preventDefault(); rename(s.slug); }} className="flex items-center gap-1.5 px-2 py-1.5">
                <input
                  autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => rename(s.slug)}
                  className="flex-1 min-w-0 bg-bg border border-accent/50 rounded-lg px-2 py-1 text-[12.5px] outline-none"
                  maxLength={40}
                />
                <button type="submit" className="grid place-items-center w-6 h-6 rounded-md text-accent hover:bg-panel"><Check size={14} /></button>
              </form>
            );
          }
          return (
            <div
              key={s.slug}
              onClick={() => { openSession(s.slug); onClose(); }}
              className={cn("group flex items-center gap-2 px-2 py-2 rounded-xl cursor-pointer transition-colors", on ? "bg-panel" : "hover:bg-panel/70")}
            >
              {isChat ? <MessageSquare size={14} className="shrink-0 text-muted" /> : <TerminalSquare size={14} className="shrink-0 text-muted" />}
              <span className={cn("flex-1 min-w-0 truncate text-[12.5px]", on ? "text-fg" : "text-fg/80")}>{label}</span>
              {/* Session 1 anchors the project - it can't be renamed or closed on its own,
                  so instead of edit/close buttons it carries a "Main" badge. Extra sessions
                  get rename + close. */}
              {s.slug === base ? (
                <span className="px-1.5 py-0.5 rounded-xs bg-panel text-muted text-[11px] font-medium shrink-0">Main</span>
              ) : (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDraft(s.name); setRenaming(s.slug); }}
                    className="grid place-items-center w-6 h-6 rounded-md text-muted hover:text-fg hover:bg-panel2 shrink-0"
                    title="Rename"
                  ><Pencil size={12} /></button>
                  <button
                    onClick={(e) => { e.stopPropagation(); close(s.slug); }}
                    className="grid place-items-center w-6 h-6 rounded-md text-muted hover:text-danger hover:bg-panel2 shrink-0"
                    title="Close session"
                  ><X size={13} /></button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <button
        onClick={addSession}
        disabled={busy || sessions.length >= cap}
        title={sessions.length >= cap ? `Up to ${cap} ${isGeneral ? "chats" : "sessions per project"}` : ""}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 border-t border-border text-[12.5px] text-accent hover:bg-panel disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {isGeneral ? "New chat" : "New session"}
      </button>
    </motion.div>
  );
}
