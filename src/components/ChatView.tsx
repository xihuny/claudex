import { Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { Plus, ArrowUp, Square, ChevronRight, Loader2, Check, X, Wrench, MessageSquare, Paperclip, Clock3, CircleHelp, Sparkles, FileText, Terminal, Target, TriangleAlert, Mic } from "lucide-react";
import { createPortal } from "react-dom";
import { m as motion } from "motion/react";
import { toast } from "sonner";
import { useStore, baseOf, GENERAL_SLUG } from "@/store/store";
import { useIsGuest } from "@/store/me";
import { api, uploadImage, uploadUrl, fsFileUrl } from "@/lib/api";
import { Lightbox } from "@/components/ui/Lightbox";
import { cn } from "@/lib/utils";
import { useDictation } from "@/lib/dictation";
import { MODEL_CHOICES, EFFORT_CHOICES, EFFORT_HINT, modelFamily, modelLabelFor, effortLabel } from "@/lib/models";
import {
  mountChat, enqueueChat, sendBash, stopBash, stopChat, subscribeChat, chatQueue, removeQueued, answerChat,
  chatItems, chatRunning, chatStatus, chatBg, chatSince, chatHydrated, chatConnected, clearChat, chatModel, chatGoal,
  type ChatItem, type ToolItem, type AskItem, type UsageItem, type NoticeItem, type ModelInfo, type GoalStatusItem, type GoalInfo,
} from "@/lib/chat";

function toolSummary(it: ToolItem): string {
  const i = it.input || {};
  if (typeof i.command === "string") return i.command;
  if (typeof i.file_path === "string") return i.file_path;
  if (typeof i.path === "string") return i.path;
  if (typeof i.pattern === "string") return i.pattern;
  if (typeof i.url === "string") return i.url;
  if (typeof i.prompt === "string") return i.prompt;
  try { return JSON.stringify(i); } catch { return ""; }
}

// How tall the composer may grow before it starts scrolling. Shared by the autosize
// helper and the textarea's max-height so both agree to the pixel.
const COMPOSER_MAX_H = 200;

// Slash commands surfaced in the composer autocomplete. /clear is handled by claudex
// itself (fresh session); the rest pass through to Claude's native slash commands.
const SLASH_COMMANDS = [
  { cmd: "/compact", desc: "Summarize the conversation to shrink the context" },
  { cmd: "/clear", desc: "Clear everything & start a fresh session" },
  { cmd: "/context", desc: "Show what's filling the context window" },
  { cmd: "/model", desc: "Show or switch the model (e.g. /model sonnet)" },
  { cmd: "/effort", desc: "Set reasoning effort (low, medium, high, xhigh, max)" },
  { cmd: "/goal", desc: "Keep working until a condition is met (/goal clear to stop)" },
];
// The subset a guest share may run. Mirrors the server's RESET_COMMANDS - this only
// shortens the menu; the refusal that matters happens server-side.
const GUEST_SLASH = new Set(["/clear"]);

// ---- model pill + picker ----
// Labels, effort levels and the id → name mapping live in @/lib/models, shared with the
// Settings pane that picks the defaults for new chats.
// The pick comes first: the raw id lags a switch by one real turn (the /model
// confirmation is synthetic), so labeling by id shows the old model until then.
// With no pick, no live process yet, and no model in settings.json there's nothing
// to name - "Default" until the process first reports its real id.
function modelLabel(info: ModelInfo): string {
  return modelLabelFor(info.chosen || info.id || info.def || "");
}

function ModelPill({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  // Second level of the menu, exactly like the web app: the model list stays put and
  // the effort levels open beside it.
  const [effortOpen, setEffortOpen] = useState(false);
  const info = chatModel(slug);
  // Prefer the pick for the family - the raw id lags one turn behind a switch.
  const src = info.chosen || info.id || info.def;
  const fam = modelFamily(src);
  // Not shown, but still steers the pick: switching families keeps the current
  // window size, so a fable[1m] user tapping Sonnet gets sonnet[1m], not 200K.
  const oneM = info.window >= 1_000_000;
  const pick = (text: string) => { enqueueChat(slug, text); setOpen(false); setEffortOpen(false); };
  const effort = info.effort;
  // Nothing nameable yet (no pick, no live process, default still being probed) -   // no chip at all; it springs in once the name arrives.
  if (!src) return null;
  return (
    <motion.div
      className="relative"
      initial={{ opacity: 0, scale: 0.8, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
    >
      <button
        onClick={() => { setOpen((o) => !o); setEffortOpen(false); }}
        title="Switch model or effort"
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-panel2 text-[12px] text-fg hover:bg-border/60 transition-colors"
      >
        <span className="font-medium whitespace-nowrap">{modelLabel(info)}</span>
        {effortLabel(effort) && <span className="text-muted whitespace-nowrap">{effortLabel(effort)}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setEffortOpen(false); }} />
          <div className="absolute bottom-full left-0 mb-2 z-50 w-72 squircle rounded-2xl border border-border bg-panel shadow-2xl shadow-black/50 p-1.5">
            {MODEL_CHOICES.map((m) => (
              <button
                key={m.alias}
                onClick={() => pick("/model " + (oneM && m.oneM ? m.alias + "[1m]" : m.alias))}
                className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-panel2 transition-colors"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] text-fg">{m.label}</span>
                  <span className="block text-[12px] text-muted">{m.desc}</span>
                </span>
                {fam === m.family && <Check size={15} className="text-accent shrink-0" />}
              </button>
            ))}
            <div className="my-1 mx-2 border-t border-border" />
            <button
              onClick={() => setEffortOpen((o) => !o)}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-panel2 transition-colors"
            >
              <span className="flex-1 text-[14px] text-fg">Effort</span>
              <span className="text-[12px] text-muted">{effortLabel(effort) ?? "Default"}</span>
              <ChevronRight size={14} className={cn("text-muted transition-transform", effortOpen && "rotate-90")} />
            </button>
            {effortOpen && (
              <div className="mt-0.5 mx-1 mb-0.5 rounded-lg bg-panel2/60 p-1">
                <p className="px-1.5 py-1.5 text-[12px] leading-snug text-muted">{EFFORT_HINT}</p>
                {EFFORT_CHOICES.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => pick("/effort " + e.id)}
                    className="w-full flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-panel transition-colors"
                  >
                    <span className="text-[14px] text-fg">{e.label}</span>
                    {"note" in e && e.note && (
                      <span className="text-[11px] text-warn whitespace-nowrap">{e.note}</span>
                    )}
                    {effort === e.id && <Check size={14} className="text-accent shrink-0 ml-auto" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}

// Markdown rendering lives in its own chunk (see MdText.tsx). The import is kicked off
// at module scope rather than on first render, so it downloads in parallel with the shell
// instead of after it - by the time a transcript paints, the chunk is normally already
// there and the plain-text fallback below never becomes visible. That fallback preserves
// whitespace so an unformatted first frame still reads correctly rather than collapsing.
const MdTextLazy = lazy(() => import("@/components/MdText"));
void import("@/components/MdText");

const MdText = memo(function MdText({ text }: { text: string }) {
  return (
    <Suspense fallback={<div className="md whitespace-pre-wrap break-words leading-relaxed">{text}</div>}>
      <MdTextLazy text={text} />
    </Suspense>
  );
});

// ── Edit-tool diff rendering ──────────────────────────────────────────────
// Edit/Write/MultiEdit carry the before/after text; render it as a plain
// red/green line diff (no absolute line numbers - the fragment is self-contained).
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);
type DL = { t: -1 | 0 | 1; v: string }; // t: -1 removed · 0 unchanged · +1 added
const DIFF_CAP = 500;   // above this many total lines, skip the O(n·m) LCS and show whole blocks
const DIFF_MAX_ROWS = 300; // clamp the rendered DOM; the rest collapses to a "… N more lines" note

// Compact LCS line diff. For small fragments (the common case) this yields a clean,
// interleaved diff; past DIFF_CAP it degrades to "all old removed, all new added".
function lineDiff(oldS: string, newS: string): DL[] {
  const a = oldS.length ? oldS.split("\n") : [];
  const b = newS.length ? newS.split("\n") : [];
  if (a.length + b.length > DIFF_CAP)
    return [...a.map((v) => ({ t: -1 as const, v })), ...b.map((v) => ({ t: 1 as const, v }))];
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DL[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: 0, v: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: -1, v: a[i] }); i++; }
    else { out.push({ t: 1, v: b[j] }); j++; }
  }
  while (i < n) out.push({ t: -1, v: a[i++] });
  while (j < m) out.push({ t: 1, v: b[j++] });
  return out;
}
// Build the diff line list for an edit tool, or null if this isn't one.
function editDiff(it: ToolItem): DL[] | null {
  if (!EDIT_TOOLS.has(it.name)) return null;
  const i = it.input || {};
  if (it.name === "Write") {
    const content: string = typeof i.content === "string" ? i.content : "";
    return content.split("\n").map((v) => ({ t: 1 as const, v }));
  }
  const edits = it.name === "MultiEdit"
    ? (Array.isArray(i.edits) ? i.edits : [])
    : [{ old_string: i.old_string, new_string: i.new_string }];
  const out: DL[] = [];
  edits.forEach((e: any, idx: number) => {
    if (idx > 0) out.push({ t: 0, v: "" }); // blank gap between hunks
    out.push(...lineDiff(typeof e?.old_string === "string" ? e.old_string : "",
                         typeof e?.new_string === "string" ? e.new_string : ""));
  });
  return out;
}
function DiffView({ lines }: { lines: DL[] }) {
  const shown = lines.slice(0, DIFF_MAX_ROWS);
  const hidden = lines.length - shown.length;
  return (
    <div className="rounded-lg border border-border bg-bg overflow-x-auto">
      <div className="text-[11.5px] leading-relaxed font-mono py-1">
        {shown.map((l, k) => (
          <div key={k} className={cn("flex w-max min-w-full", l.t === 1 && "bg-accent/12", l.t === -1 && "bg-danger/12")}>
            <span className={cn("select-none w-5 text-center shrink-0", l.t === 1 ? "text-accent" : l.t === -1 ? "text-danger" : "text-transparent")}>
              {l.t === 1 ? "+" : l.t === -1 ? "−" : ""}
            </span>
            <span className={cn("whitespace-pre pr-3", l.t === 0 ? "text-muted" : "text-fg")}>{l.v || " "}</span>
          </div>
        ))}
      </div>
      {hidden > 0 && <div className="px-2.5 py-1 text-[11px] text-muted border-t border-border">… {hidden} more lines</div>}
    </div>
  );
}

// ── Read-tool file rendering ──────────────────────────────────────────────
// Read results arrive in cat -n format ("   12\tcode…"); parse that into rows and
// render a real gutter instead of leaking the number+tab prefixes into a raw <pre>.
type NL = { n: number; v: string };
// Rows are the leading run of numbered lines; anything after (e.g. an appended
// <system-reminder>, or a line cut mid-prefix by the server's 6000-char cap)
// becomes `tail` and renders as a muted footnote.
function readLines(it: ToolItem): { rows: NL[]; tail: string } | null {
  if (it.name !== "Read" || it.isError || typeof it.result !== "string" || !it.result) return null;
  const lines = it.result.split("\n");
  const rows: NL[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^\s*(\d+)\t(.*)$/.exec(lines[i]);
    if (!m) break;
    rows.push({ n: +m[1], v: m[2] });
  }
  if (!rows.length) return null; // not cat -n output (image, empty-file reminder…) - plain <pre> fallback
  return { rows, tail: lines.slice(i).join("\n").trim() };
}
function ReadView({ rows, tail }: { rows: NL[]; tail: string }) {
  const shown = rows.slice(0, DIFF_MAX_ROWS);
  const hidden = rows.length - shown.length;
  // Gutter sized to the widest number shown (an `offset` read can start deep in a file,
  // so this is the LAST row's width, not the first's).
  const w = String(shown[shown.length - 1]?.n ?? 1).length;
  return (
    <div className="rounded-lg border border-border bg-bg overflow-auto max-h-72">
      {/* w-max: the track is as wide as its widest line, so every row's sticky gutter
          shares one scroll context and the rows all span the full scrollable width
          (a short line still gets an unbroken gutter strip beside it). */}
      <div className="w-max min-w-full text-[11.5px] leading-relaxed font-mono py-1">
        {shown.map((l) => (
          <div key={l.n} className="flex">
            {/* The gutter is a true column, not a prefix: fixed ch width so digits can't
                push into the code, sticky so it stays put when a long line scrolls
                sideways, and opaque + z-10 so the code passes UNDER it rather than
                through it. Its own bg + right border make the column visible. */}
            <span
              className="select-none shrink-0 sticky left-0 z-10 bg-panel border-r border-border pl-2.5 pr-2 py-px text-right text-muted/55 tabular-nums"
              style={{ width: `calc(${w}ch + 1.1rem)` }}
            >
              {l.n}
            </span>
            {/* whitespace-pre inline, not just as a class: nothing in the cascade can
                turn a long line into a wrap that would drop code beneath the gutter. */}
            <span className="shrink-0 pl-3 pr-4 py-px text-fg" style={{ whiteSpace: "pre" }}>{l.v || " "}</span>
          </div>
        ))}
      </div>
      {/* Notes sit outside the w-max track (so they don't widen it); sticky keeps them
          in view instead of drifting off-screen when the code is scrolled sideways. */}
      {hidden > 0 && <div className="sticky left-0 px-2.5 py-1 text-[11px] text-muted border-t border-border">… {hidden} more lines</div>}
      {tail && <div className="sticky left-0 px-2.5 py-1 text-[11px] text-muted border-t border-border whitespace-pre-wrap break-words">{tail}</div>}
    </div>
  );
}

// ── Read-tool image preview ───────────────────────────────────────────────
// Reading an image yields no text worth showing (the server flattens the image block to
// "[image]"), so the card shows the picture itself instead.
const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
// Raw-bytes URL for a file inside the project (see fsFileUrl in api.ts); the server also
// takes the absolute file_path a Read card carries, confined to the project root.
function readImagePath(it: ToolItem): string | null {
  if (it.name !== "Read" || it.isError) return null;
  const p = it.input?.file_path;
  return typeof p === "string" && IMG_RE.test(p) ? p : null;
}

function ToolCard({ it, slug }: { it: ToolItem; slug: string }) {
  const img = useMemo(() => readImagePath(it), [it.name, it.input, it.isError]);
  const [zoom, setZoom] = useState<string | null>(null);
  // The tool's own returned image wins: it works for files outside the project root.
  const imgSrc = it.image ? uploadUrl(it.image) : img ? fsFileUrl(slug, img) : null;
  // Holds the src that failed, so a later src (the result's image) gets its own try.
  const [broken, setBroken] = useState<string | null>(null);
  const showImg = !!imgSrc && broken !== imgSrc;
  // Claude's own tool calls collapse (there are many, and they're skimmable); a command
  // YOU ran opens with its output showing, the way it would in a terminal. An image read
  // opens too - a collapsed card would hide the one thing worth seeing.
  const [open, setOpen] = useState(!!it.local || !!img);
  // Input is immutable after the tool_use event (tool_result only adds `result`),
  // so the diff computes once and is memoised - no recompute on status changes.
  const diff = useMemo(() => editDiff(it), [it.name, it.input]);
  // Same idea for Read: parse once per result, not on every open/close toggle.
  const read = useMemo(() => readLines(it), [it.name, it.result, it.isError]);
  const adds = diff ? diff.reduce((n, l) => n + (l.t === 1 ? 1 : 0), 0) : 0;
  const dels = diff ? diff.reduce((n, l) => n + (l.t === -1 ? 1 : 0), 0) : 0;
  return (
    <div className="rounded-xl border border-border bg-panel/50 overflow-hidden">
      {/* Header row: the expand toggle and Stop are siblings - a Stop nested inside the
          toggle button would be invalid HTML and swallow its own clicks. */}
      <div className="flex items-center">
        <button onClick={() => setOpen((o) => !o)} className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left">
          <ChevronRight size={14} className={cn("text-muted transition-transform shrink-0", open && "rotate-90")} />
          {it.local
            ? <Terminal size={13} className="text-warn shrink-0" />
            : <Wrench size={13} className="text-muted shrink-0" />}
          <span className="text-[13px] font-medium shrink-0">{it.local ? "You ran" : it.name}</span>
          <span className="text-[12px] text-muted truncate flex-1 font-mono">{toolSummary(it)}</span>
          {diff && (adds > 0 || dels > 0) && (
            <span className="shrink-0 flex items-center gap-1.5 text-[11px] font-mono tabular-nums">
              {adds > 0 && <span className="text-accent">+{adds}</span>}
              {dels > 0 && <span className="text-danger">−{dels}</span>}
            </span>
          )}
          {it.status === "running" ? <Loader2 size={13} className="animate-spin text-muted shrink-0" />
            : it.isError ? <X size={13} className="text-danger shrink-0" />
            : <Check size={13} className="text-accent shrink-0" />}
        </button>
        {/* A long "!cmd" (a build, a dev server) needs an out - this kills its whole
            process group, so nothing it spawned is left orphaned holding a port. */}
        {it.local && it.status === "running" && (
          <button onClick={() => stopBash(slug, it.id)} title="Stop command"
            className="shrink-0 grid place-items-center w-7 h-7 mr-2 rounded-md bg-danger/15 text-danger hover:bg-danger/25 transition-colors">
            <Square size={11} fill="currentColor" />
          </button>
        )}
      </div>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          {/* A local "!cmd" card skips the input dump - the header already shows the whole
              command verbatim, so all that's left worth seeing is its output. */}
          {/* Read replaces the input dump too - the header already shows the path,
              so the numbered file body is the only thing worth the space. */}
          {diff ? <DiffView lines={diff} />
            : read ? <ReadView rows={read.rows} tail={read.tail} />
            : showImg ? (
              // Capped short so a tall screenshot can't push the rest of the turn off
              // screen; tap opens the full-size Lightbox. A file that can't be served
              // (deleted, outside the project) falls back to the plain input dump.
              <button onClick={() => setZoom(imgSrc)} className="self-start max-w-full">
                <img
                  src={imgSrc!}
                  alt={img?.split(/[\\/]/).pop() || "image"}
                  loading="lazy"
                  onError={() => setBroken(imgSrc)}
                  className="max-h-56 max-w-full w-auto rounded-lg border border-border object-contain"
                />
              </button>
            )
            : it.local ? null
            : (
              <pre className="p-2.5 rounded-lg bg-bg border border-border overflow-x-auto text-[11.5px] leading-relaxed text-muted">
                {(() => { try { return JSON.stringify(it.input, null, 2); } catch { return String(it.input); } })()}
              </pre>
            )}
          {it.result != null && it.result !== "" && !read && !showImg && (!diff || it.isError) && (
            <pre className={cn("p-2.5 rounded-lg bg-bg border border-border overflow-x-auto max-h-72 text-[11.5px] leading-relaxed whitespace-pre-wrap break-words", it.isError ? "text-danger" : "text-fg/80")}>
              {it.result}
            </pre>
          )}
        </div>
      )}
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}

// Renders an ask_user question: radio (single) or checkbox (multi) options per
// question, with a Submit that returns the picks to Claude. Locks once answered.
function AskCard({ it, slug }: { it: AskItem; slug: string }) {
  const [sel, setSel] = useState<string[][]>(() => it.questions.map(() => []));
  // Free-text "Other" value per question. On answered history replay, recover it as
  // any submitted answer that doesn't match one of the listed option labels.
  const [other, setOther] = useState<string[]>(() =>
    it.questions.map((q, qi) => {
      if (!it.answered || !it.answers) return "";
      const labels = new Set(q.options.map((o) => o.label));
      return (it.answers[qi] || []).filter((a) => !labels.has(a)).join(", ");
    })
  );
  // A stale card is one whose process died still parked on the question - the options are
  // still worth answering, but there is no tool call left to return them to. Keep it
  // interactive and send the picks as an ordinary message instead (the session resumes on
  // it), rather than locking the user out of a question they were about to answer.
  const [sent, setSent] = useState(false);
  const stale = !!it.stale && !sent;
  const answered = !!it.answered && !stale;
  const display = answered ? (it.answers || it.questions.map(() => [])) : sel;
  const anySel = (it.answers || []).some((a) => a && a.length);
  const headerLabel = stale ? "Question expired - the session restarted"
    : !answered ? "Claude needs your input"
    : it.note && !anySel ? "Discussed" : "Answered";

  const toggle = (qi: number, label: string, multi: boolean) => {
    if (answered) return;
    setSel((prev) => {
      const next = prev.map((a) => a.slice());
      if (multi) next[qi] = next[qi].includes(label) ? next[qi].filter((l) => l !== label) : [...next[qi], label];
      else next[qi] = [label];
      return next;
    });
    if (!multi) setOther((prev) => { const n = prev.slice(); n[qi] = ""; return n; });   // single-select: picking clears Other
  };
  const setOtherText = (qi: number, val: string, multi: boolean) => {
    if (answered) return;
    setOther((prev) => { const n = prev.slice(); n[qi] = val; return n; });
    if (!multi && val.trim()) setSel((prev) => { const n = prev.map((a) => a.slice()); n[qi] = []; return n; });   // single-select: typing clears the pick
  };
  const picked = (qi: number) => (sel[qi]?.length ?? 0) > 0 || (other[qi] ?? "").trim() !== "";
  const canSubmit = !answered && it.questions.every((_, qi) => picked(qi));
  const submit = () => {
    if (!canSubmit) return;
    const finalAnswers = it.questions.map((_, qi) => {
      const picks = sel[qi] ? sel[qi].slice() : [];
      const o = (other[qi] ?? "").trim();
      if (o) picks.push(o);
      return picks;
    });
    if (stale) {
      // No tool call is waiting on this, so answer it the way a person would if the card
      // weren't here: as a message quoting what was asked.
      const text = it.questions
        .map((q, qi) => `${q.question}\n→ ${finalAnswers[qi].join(", ")}`)
        .join("\n\n");
      enqueueChat(slug, text);
      setSent(true);
      return;
    }
    answerChat(slug, it.id, finalAnswers);
  };

  return (
    // data-ask: the transcript scroller finds this card to bring its top into view.
    <div data-ask={it.id} className={cn("rounded-xl border bg-panel overflow-hidden", answered ? "border-border" : "border-accent/40")}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <CircleHelp size={14} className={cn("shrink-0", answered ? "text-muted" : "text-accent")} />
        <span className="text-[13px] font-medium">{headerLabel}</span>
      </div>
      <div className="px-3 py-2.5 flex flex-col gap-3.5">
        {it.questions.map((q, qi) => {
          const multi = !!q.multiSelect;
          return (
            <div key={qi} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                {q.header && <span className="text-[11px] px-1.5 py-0.5 rounded-xs bg-panel2 text-muted font-medium">{q.header}</span>}
                <span className="text-[14px] font-medium">{q.question}</span>
              </div>
              <div className="flex flex-col gap-1">
                {q.options.map((o, oi) => {
                  const on = (display[qi] || []).includes(o.label);
                  return (
                    <button
                      key={oi}
                      disabled={answered}
                      onClick={() => toggle(qi, o.label, multi)}
                      className={cn(
                        "flex items-start gap-2 text-left px-2.5 py-2 rounded-md border transition-colors",
                        on ? "border-accent/60 bg-accent/10" : "border-border bg-bg hover:bg-panel2",
                        answered && "cursor-default"
                      )}
                    >
                      <span className={cn("mt-0.5 grid place-items-center w-4 h-4 shrink-0 border", multi ? "rounded" : "rounded-full", on ? "bg-accent border-accent text-bg" : "border-muted")}>
                        {on && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="flex flex-col">
                        <span className="text-[13px] leading-snug">{o.label}</span>
                        {o.description && <span className="text-[12px] text-muted leading-snug">{o.description}</span>}
                      </span>
                    </button>
                  );
                })}
                {q.allowOther && (
                  <label
                    className={cn(
                      "flex items-center gap-2 px-2.5 py-2 rounded-md border transition-colors",
                      (other[qi] ?? "").trim() ? "border-accent/60 bg-accent/10" : "border-border bg-bg"
                    )}
                  >
                    <span className={cn("grid place-items-center w-4 h-4 shrink-0 border", multi ? "rounded" : "rounded-full", (other[qi] ?? "").trim() ? "bg-accent border-accent text-bg" : "border-muted")}>
                      {(other[qi] ?? "").trim() && <Check size={11} strokeWidth={3} />}
                    </span>
                    <input
                      value={other[qi] ?? ""}
                      disabled={answered}
                      onChange={(e) => setOtherText(qi, e.target.value, multi)}
                      placeholder="Other… (type your own)"
                      className="flex-1 bg-transparent text-[13px] leading-snug outline-none placeholder:text-muted disabled:cursor-default"
                    />
                  </label>
                )}
              </div>
            </div>
          );
        })}
        {answered && it.note && (
          <div className="text-[13px] text-fg/70 italic border-l-2 border-border pl-2.5">You replied: “{it.note}”</div>
        )}
        {!answered && (
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={cn("self-end px-3.5 h-8 rounded-md text-[13px] font-medium transition-colors", canSubmit ? "bg-accent text-bg hover:bg-accent2" : "bg-panel2 text-muted cursor-not-allowed")}
          >
            {stale ? "Send as message" : "Submit"}
          </button>
        )}
      </div>
    </div>
  );
}

// Smoothly reveal `target` one steady stream of characters at a time instead of in
// the bursts the network delivers. The reveal rate is adaptive - it catches up fast
// when far behind and eases to ~1 char/frame near the end - so text flows in like a
// calm typewriter rather than snapping in chunks. Once streaming ends it shows it all.
function useSmoothReveal(target: string, enabled: boolean) {
  const [shown, setShown] = useState(() => (enabled ? "" : target));
  const targetRef = useRef(target);
  const lenRef = useRef(enabled ? 0 : target.length);
  const rafRef = useRef(0);
  targetRef.current = target;

  useEffect(() => {
    if (!enabled) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
      lenRef.current = target.length;
      setShown(target);
      return;
    }
    if (lenRef.current > target.length) { lenRef.current = target.length; setShown(target); }   // target shrank (reset)
    const tick = () => {
      const t = targetRef.current;
      const len = lenRef.current;
      if (len >= t.length) { rafRef.current = 0; return; }
      const step = Math.max(1, Math.round((t.length - len) / 6));   // adaptive catch-up
      lenRef.current = Math.min(t.length, len + step);
      setShown(t.slice(0, lenRef.current));
      rafRef.current = requestAnimationFrame(tick);
    };
    if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } };
  }, [target, enabled]);

  return shown;
}

function AssistantText({ text, streaming, onReveal }: { text: string; streaming?: boolean; onReveal?: () => void }) {
  const shown = useSmoothReveal(text, !!streaming);
  // After each revealed chunk commits to the DOM, ask the list to stick to the bottom.
  // Running in a layout effect (post-commit) means scrollHeight is already up to date,
  // so the follow tracks the growing text in real time instead of jumping at the end.
  useLayoutEffect(() => { if (streaming) onReveal?.(); }, [shown, streaming, onReveal]);
  return (
    <div className="text-[14px] leading-relaxed text-fg/95">
      <MdText text={shown} />
      {streaming && <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-accent animate-pulse" />}
    </div>
  );
}

// memo'd: the reducer rebuilds the items array immutably, so every bubble except the
// one that changed keeps its object reference - React.memo skips re-rendering them.
// Combined with the streamed deltas only mutating the last item, a token only ever
// re-renders one bubble instead of the whole transcript.
// Quiet per-turn token watchdog. Muted normally; flips amber when the turn rewrote a
// large chunk of cache (cacheCreate high) - i.e. an expensive cache-miss spike, the
// regression signal worth noticing. No $ (subscription plan), tokens only.
const fmtTok = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));
const fmtDur = (ms: number) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
function UsageLine({ it }: { it: UsageItem }) {
  // ↑ = the turn's true context size (server's ctx), NOT in+cacheRead+cacheCreate.
  // On a cache-miss turn the big cacheCreate happens on an early step and folds into a
  // later step's cacheRead; re-summing here double-counts it (e.g. 120k ctx shows 241k).
  // Fall back to the sum only for legacy events with no ctx.
  const totalIn = it.ctx || it.in + it.cacheRead + it.cacheCreate;
  const spike = it.cacheCreate >= 40000;
  return (
    <div className={cn("flex items-center justify-between gap-2 text-[11px] tabular-nums px-1", spike ? "text-warn" : "text-muted/60")} title="Tokens this turn: ↑ input (cached) · ↓ output">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
        <span>↑ {fmtTok(totalIn)}</span>
        <span>· {fmtTok(it.cacheRead)} cached</span>
        {spike && <span className="font-semibold">· ⚠ {fmtTok(it.cacheCreate)} rewritten</span>}
        <span>· ↓ {fmtTok(it.out)}</span>
      </div>
      {it.ms > 0 && <span className="flex items-center gap-1 shrink-0"><Clock3 size={11} /> {fmtDur(it.ms)}</span>}
    </div>
  );
}

// Centered system line for events with no conversational reply (e.g. /compact).
// Wraps naturally on narrow widths - never scrolls horizontally.
function NoticeLine({ it }: { it: NoticeItem }) {
  return (
    <div className="flex items-center gap-2.5 py-1 text-[12px] text-muted">
      <div className="h-px flex-1 bg-border" />
      <div className="flex items-center gap-1.5 shrink min-w-0 text-center text-balance break-words">
        <Sparkles size={12} className="text-muted shrink-0" />
        <span className="min-w-0">{it.text}</span>
      </div>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

// ---- /goal ----
// Most-significant unit only ("5m", not "5m 23s") - same as the CLI. The elapsed readout
// switches to a 1/min tick past the first minute, so showing seconds there would look
// frozen for 59 of every 60 seconds.
const fmtAgo = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `${hr}h` : `${Math.floor(hr / 24)}d`;
};
const goalStats = (it: GoalStatusItem) => [
  it.durationMs !== undefined ? fmtAgo(it.durationMs) : null,
  it.iterations !== undefined ? `${it.iterations} turn${it.iterations === 1 ? "" : "s"}` : null,
  it.tokens !== undefined ? `${fmtTok(it.tokens)} tokens` : null,
].filter(Boolean).join(" · ");

// One evaluator verdict. Success is a single line - the run is over and the transcript
// above already says what happened. The other two keep the reason, which is the only
// thing that tells you why Claude is still going, or why it gave up.
function GoalStatusCard({ it }: { it: GoalStatusItem }) {
  const stats = goalStats(it);
  return (
    <div className="my-1 flex items-center gap-2 py-1 text-[12px]">
      {it.failed ? <TriangleAlert size={13} className="text-danger shrink-0" />
        : it.met ? <Check size={13} className="text-accent shrink-0" strokeWidth={3} />
        : <Loader2 size={12} className="text-muted shrink-0 animate-spin" />}
      <span className={cn("font-medium shrink-0", it.failed ? "text-danger" : it.met ? "text-accent" : "text-muted")}>
        {it.failed ? "Goal could not be achieved" : it.met ? "Goal achieved" : "Goal not yet met… continuing"}
      </span>
      {stats && <span className="text-muted/70 text-[11px] tabular-nums shrink-0">· {stats}</span>}
      {!it.met && it.reason && <span className="text-muted/70 text-[11px] truncate min-w-0" title={it.reason}>· {it.reason}</span>}
    </div>
  );
}

// Persistent "a goal is in force" chip above the composer - the counterpart to the CLI's
// "◎ /goal active (5m)" status line. Collapsed to one line by default: a long condition
// would otherwise eat the composer. Tap to see the condition and the last verdict.
function GoalBar({ slug, goal }: { slug: string; goal: GoalInfo }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const elapsed = now - goal.setAt;
  const fine = elapsed < 60_000;   // seconds matter only in the first minute
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), fine ? 1000 : 60_000);
    return () => clearInterval(id);
  }, [fine]);
  const parts = [fmtAgo(elapsed), goal.iterations > 0 ? `${goal.iterations} turn${goal.iterations === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-1.5 rounded-xl bg-panel border border-border text-[13px] overflow-hidden"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? "Hide details" : "Show goal"}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-panel2 transition-colors"
      >
        <Target size={13} className="text-accent shrink-0 animate-pulse" />
        <span className="font-medium text-accent shrink-0">Goal active</span>
        <span className="text-[11px] text-muted tabular-nums shrink-0">· {parts}</span>
        <ChevronRight size={14} className={cn("ml-auto shrink-0 text-muted transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="px-3 pb-2 pt-1.5 border-t border-border text-[12px]">
          <div className="text-fg/80 break-words">{goal.condition}</div>
          {goal.lastReason && <div className="mt-1 text-muted break-words"><span className="text-muted/70">Last check: </span>{goal.lastReason}</div>}
          {/* Destructive and off to the right: clearing a goal can't be undone (the Stop
              hook is gone; you'd have to re-arm it), so it reads as a warning and sits
              where a dialog's confirm action would, not in the reading path. */}
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => enqueueChat(slug, "/goal clear")}
              title="Clear goal"
              className="inline-flex items-center gap-1 px-2 h-7 rounded-md border border-danger/30 text-danger hover:bg-danger/10 text-[12px] font-medium transition-colors"
            >
              <TriangleAlert size={11} className="shrink-0" />
              Clear goal
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ---- session time dividers ----
// A gap this long between two user messages reads as "I came back to this later" rather
// than a pause mid-thought, and earns a divider.
const SESSION_GAP_MS = 30 * 60 * 1000;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
// Absolute, never relative: this transcript is re-read days later, when "2 hours ago"
// would be a lie. Formatted in the *viewer's* timezone (the server stamps epoch ms), so
// checking from a phone in another timezone still reads correctly.
function fmtStamp(ms: number) {
  const d = new Date(ms), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `Today ${time}`;
  if (sameDay(d, yest)) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}
// Indices that open a session: the first stamped message, anything after an idle gap, and
// any calendar-day change (working through midnight is a new day even with no real gap).
// Unstamped items (transcripts saved before timestamps existed) are skipped entirely
// rather than treated as epoch 0, which would banner every old chat with "1 Jan 1970".
function sessionStarts(items: ChatItem[]) {
  const marks = new Map<number, string>();
  let prev = 0;
  items.forEach((it, i) => {
    const at = it.kind === "user" ? it.at : undefined;
    if (!at) return;
    if (!prev || at - prev > SESSION_GAP_MS || !sameDay(new Date(at), new Date(prev))) marks.set(i, fmtStamp(at));
    prev = at;
  });
  return marks;
}
function TimeDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 pb-3.5 text-[11px] text-muted/70">
      <div className="h-px flex-1 bg-border" />
      <span className="shrink-0 tabular-nums">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

const Message = memo(function Message({ it, slug, onReveal }: { it: ChatItem; slug: string; onReveal?: () => void }) {
  if (it.kind === "tool") return <ToolCard it={it} slug={slug} />;
  if (it.kind === "usage") return <UsageLine it={it} />;
  if (it.kind === "notice") return <NoticeLine it={it} />;
  if (it.kind === "goal_status") return <GoalStatusCard it={it} />;
  if (it.kind === "ask") return <AskCard it={it} slug={slug} />;
  if (it.kind === "user") return <UserMessage text={it.text} />;
  return <AssistantText text={it.text} streaming={it.streaming} onReveal={onReveal} />;
});

// Uploaded images are appended to the outgoing message as bare ~/claude-uploads/*.png
// path lines. Detect those lines and render them as thumbnails instead of raw URLs.
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)$/i;
// Owner uploads live in ~/claude-uploads, a share's in ~/claude-uploads-guests/<id>.
const isUploadImagePath = (s: string) => /(^|[\\/])claude-uploads(-guests[\\/][^\\/]+)?[\\/]/.test(s.trim()) && IMG_EXT.test(s.trim());

function UserMessage({ text }: { text: string }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const { body, images } = useMemo(() => {
    const imgs: { src: string; name: string }[] = [];
    const keep: string[] = [];
    for (const line of text.split("\n")) {
      if (isUploadImagePath(line)) {
        const t = line.trim();
        imgs.push({ src: uploadUrl(t), name: t.split(/[\\/]/).pop() || "image" });
      } else keep.push(line);
    }
    return { body: keep.join("\n").trim(), images: imgs };
  }, [text]);

  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] flex flex-col items-end gap-1.5">
        {images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {images.map((img, i) => (
              <button
                key={i}
                onClick={() => setZoom(img.src)}
                title={img.name}
                className="block w-24 h-24 rounded-lg overflow-hidden border border-border bg-panel2 hover:border-muted/60 transition-colors"
              >
                <img src={img.src} alt={img.name} loading="lazy" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
        {body && (
          <div className="rounded-2xl rounded-br-sm bg-panel2 px-3.5 py-2 text-[14px] text-fg whitespace-pre-wrap [overflow-wrap:anywhere]">
            {body}
          </div>
        )}
      </div>
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}


// The footer shows the "Working…" pulse while a turn is mid-flight and the last item
// isn't already an assistant bubble.
// pb-14 reserves ~56px of headroom below the last message so streaming text scrolls
// up *before* it reaches the bottom edge (the auto-follow chases this padded bottom)
// and the "Working…" label clears the bottom fade gradient instead of dissolving into it.
// Shows the live activity label from the stream ("Thinking…", "Running Bash…",
// "Compacting…") plus an elapsed timer - the chat's take on the CLI status line.
function ChatFooter({ context }: { context?: { working: boolean; status: string; since: number; bg: number } }) {
  const working = !!context?.working;
  // Background tasks keep running after the turn ends, so this renders independently of
  // `working` - quieter than the main status line, since the composer is usable meanwhile.
  const bg = context?.bg || 0;
  const [, tick] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!working) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [working]);
  const secs = working && context?.since ? Math.max(0, Math.floor((Date.now() - context.since) / 1000)) : 0;
  const elapsed = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
  return (
    <div className="max-w-3xl mx-auto w-full px-3.5 pt-3 pb-14">
      {(working || bg > 0) && (
        <div className="flex items-center gap-2 text-[13px]">
          {working && (
            <>
              <span className="cx-star shrink-0" aria-hidden />
              <span className="cx-working font-medium">{context?.status || "Working…"}</span>
              {secs >= 1 && <span className="text-muted tabular-nums text-[12px]">· {elapsed}</span>}
            </>
          )}
          {/* ml-auto keeps it right-aligned whether or not the status is beside it. Label
              stays short so it survives a narrow phone width next to a long status. */}
          {bg > 0 && (
            <span className="ml-auto flex items-center gap-1.5 text-[12px] text-muted shrink-0">
              <Loader2 size={12} className="animate-spin shrink-0" />
              {bg === 1 ? "1 background task" : `${bg} background tasks`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Placeholder transcript shown while a session's history streams in from the server - // a few shimmering bubbles laid out like real messages, so switching into a chat reads
// as "loading" instead of flashing blank or the empty-state prompt. The small stagger
// (animation-delay) keeps the sweep from marching in lockstep, which feels more alive.
function ChatSkeleton() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden>
      <div className="max-w-3xl mx-auto w-full px-3.5 pt-6 flex flex-col gap-6">
        {/* assistant reply */}
        <div className="flex flex-col gap-2">
          <div className="cx-skeleton h-3.5 rounded-md w-[72%]" style={{ animationDelay: "0ms" }} />
          <div className="cx-skeleton h-3.5 rounded-md w-[88%]" style={{ animationDelay: "80ms" }} />
          <div className="cx-skeleton h-3.5 rounded-md w-[54%]" style={{ animationDelay: "160ms" }} />
        </div>
        {/* user bubble */}
        <div className="flex justify-end">
          <div className="cx-skeleton h-10 rounded-2xl rounded-br-sm w-[46%]" style={{ animationDelay: "120ms" }} />
        </div>
        {/* tool card */}
        <div className="cx-skeleton h-10 rounded-xl w-full" style={{ animationDelay: "200ms" }} />
        {/* assistant reply */}
        <div className="flex flex-col gap-2">
          <div className="cx-skeleton h-3.5 rounded-md w-[80%]" style={{ animationDelay: "240ms" }} />
          <div className="cx-skeleton h-3.5 rounded-md w-[64%]" style={{ animationDelay: "320ms" }} />
          <div className="cx-skeleton h-3.5 rounded-md w-[38%]" style={{ animationDelay: "400ms" }} />
        </div>
      </div>
    </div>
  );
}

const TAIL_INITIAL = 150;   // newest messages rendered up front
const TAIL_CHUNK = 250;     // revealed per "Show earlier" tap

function ChatPane({ slug, active }: { slug: string; active: boolean }) {
  const [, force] = useReducer((x) => x + 1, 0);
  const guest = useIsGuest();
  const [draft, setDraft] = useState("");
  // `url` is a client-side object URL used only for the composer thumbnail (images);
  // `path` is the server-side file passed to Claude. Object URLs are revoked on remove
  // and on unmount so previews don't leak.
  const [attachments, setAttachments] = useState<{ name: string; path: string; url?: string; isImage: boolean }[]>([]);
  const [mentionPaths, setMentionPaths] = useState<string[]>([]);   // committed @-file paths, highlighted inline in the draft
  const [uploading, setUploading] = useState(false);
  const [isCoarse] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);   // latest attachments, for unmount cleanup
  attachmentsRef.current = attachments;
  const [scrollerEl, setScrollerEl] = useState<HTMLElement | null>(null);
  const scrollerNodeRef = useRef<HTMLElement | null>(null);
  const pinnedRef = useRef(true);   // following the bottom (until the user scrolls up)
  const rafRef = useRef(0);
  // The transcript is a PLAIN native scroller - deliberately NOT virtualized. A
  // virtualized list estimates the heights of unmounted items above the viewport and
  // corrects scrollTop as they mount and measure; those async corrections land during
  // iOS touch momentum and yank the view to "random" positions (reproduced and
  // stack-traced to react-virtuoso's internal scrollBy compensation). With everything
  // rendered, nothing but the user (and the explicit bottom-follow) ever moves the
  // scroll. Memory stays bounded by rendering only the newest TAIL_INITIAL messages;
  // "Show earlier" reveals older chunks with a single synchronous scroll anchor.
  const [tail, setTail] = useState(TAIL_INITIAL);
  const anchorRef = useRef<number | null>(null);   // distance-from-bottom to restore after a chunk reveal

  // Glue to the absolute bottom (incl. the headroom footer). Stable identity (so it
  // doesn't bust Message's memo) and reads the live DOM scrollHeight, so when called
  // right after a render commit it tracks growing content exactly. No-op when unpinned.
  const stickToBottom = useCallback(() => {
    const el = scrollerNodeRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, []);

  // Coalesce the firehose of stream events into at most one re-render per frame.
  // Without this, every streamed token triggers a synchronous render; batching to a
  // single requestAnimationFrame flush keeps a long, fast-streaming chat smooth.
  const scheduleForce = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; force(); });
  }, []);

  useEffect(() => {
    mountChat(slug);
    const un = subscribeChat(slug, scheduleForce);
    return () => { un(); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [slug, scheduleForce]);

  const items = chatItems(slug);
  const marks = useMemo(() => sessionStarts(items), [items]);
  const running = chatRunning(slug);
  const hydrated = chatHydrated(slug);
  const connected = chatConnected(slug);

  // Hold the banner back for a moment. A resync after unlocking the phone usually lands
  // well inside this, and flashing "Reconnecting…" for 200ms every time you reopen the app
  // reads as breakage - the banner should mean "this is actually taking a while".
  const [showReconnecting, setShowReconnecting] = useState(false);
  useEffect(() => {
    if (connected) { setShowReconnecting(false); return; }
    const t = window.setTimeout(() => setShowReconnecting(true), 1500);
    return () => clearTimeout(t);
  }, [connected]);

  const scrollToBottom = useCallback((behavior: "smooth" | "auto" = "auto") => {
    pinnedRef.current = true;   // explicit jump re-engages follow
    const el = scrollerNodeRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Start at the newest message once history hydrates (and on first mount of an
  // already-hydrated pane) - the plain-scroller replacement for Virtuoso's
  // initialTopMostItemIndex. Layout effect so the jump lands before paint.
  useLayoutEffect(() => {
    if (!hydrated) return;
    const el = scrollerNodeRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
  }, [hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reveal an older chunk, keeping the viewport glued to the message the user was
  // reading: remember the distance from the BOTTOM (immune to top insertion), then
  // restore it synchronously in the same layout pass - one deterministic adjustment
  // at tap time, never during scrolling.
  const loadEarlier = useCallback(() => {
    const el = scrollerNodeRef.current;
    anchorRef.current = el ? el.scrollHeight - el.scrollTop : null;
    setTail((t) => t + TAIL_CHUNK);
  }, []);
  useLayoutEffect(() => {
    const el = scrollerNodeRef.current;
    if (el && anchorRef.current != null) { el.scrollTop = el.scrollHeight - anchorRef.current; anchorRef.current = null; }
  }, [tail]);

  // Focus the input and snap to the latest message when this chat becomes active.
  useEffect(() => {
    if (!active) return;
    if (!isCoarse) requestAnimationFrame(() => taRef.current?.focus());
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [active, isCoarse, scrollToBottom]);

  // Stick to the bottom whenever the structure changes - a new item appended (user
  // message, tool card) or a turn starting/finishing (the "Working…" footer toggling).
  // Streaming *text* growth is handled separately by AssistantText's onReveal. rAF so
  // the read happens after the DOM has laid out. No-op while the user has scrolled up.
  useEffect(() => {
    requestAnimationFrame(stickToBottom);
  }, [items.length, running, stickToBottom]);

  // Keep the view glued to the newest message when the scroller itself RESIZES - the iOS
  // keyboard shrinking #app. scrollTop is a distance from the TOP, so a height change leaves
  // it pointing at older content ("jumps up by the keyboard height"). stickToBottom re-glues
  // only while pinned, so a deliberately scrolled-up position is left alone.
  useEffect(() => {
    if (!scrollerEl) return;
    const ro = new ResizeObserver(() => stickToBottom());
    ro.observe(scrollerEl);
    return () => ro.disconnect();
  }, [scrollerEl, stickToBottom]);

  // Only a real user gesture unpins - wheel-up, or a finger drag upward. Programmatic
  // scrolls (the bottom-follow, the chunk-reveal anchor) must NOT unpin, or the view
  // gets stranded short of the bottom (e.g. the "Working…" footer near the input).
  // Reaching the bottom always re-pins.
  useEffect(() => {
    if (!scrollerEl) return;
    let last = scrollerEl.scrollTop;
    let touching = false;
    const onWheel = (e: WheelEvent) => { if (e.deltaY < 0) pinnedRef.current = false; };
    const onTouchStart = () => { touching = true; };
    const onTouchEnd = () => { touching = false; };
    const onScroll = () => {
      const st = scrollerEl.scrollTop;
      const dist = scrollerEl.scrollHeight - st - scrollerEl.clientHeight;
      if (dist < 24) pinnedRef.current = true;                       // at bottom → follow
      else if (touching && st < last - 2) pinnedRef.current = false; // user dragged up
      last = st;
    };
    scrollerEl.addEventListener("wheel", onWheel, { passive: true });
    scrollerEl.addEventListener("touchstart", onTouchStart, { passive: true });
    scrollerEl.addEventListener("touchend", onTouchEnd, { passive: true });
    scrollerEl.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollerEl.removeEventListener("wheel", onWheel);
      scrollerEl.removeEventListener("touchstart", onTouchStart);
      scrollerEl.removeEventListener("touchend", onTouchEnd);
      scrollerEl.removeEventListener("scroll", onScroll);
    };
  }, [scrollerEl]);

  // Upload each file, attach it, and (for images) keep an object URL for the composer
  // thumbnail. Shared by the device picker and clipboard paste so both behave the same.
  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        const isImage = f.type.startsWith("image/");
        const url = isImage ? URL.createObjectURL(f) : undefined;
        try {
          const path = await uploadImage(f);
          setAttachments((a) => [...a, { name: f.name, path, url, isImage }]);
        } catch (err: any) {
          if (url) URL.revokeObjectURL(url);
          throw err;
        }
      }
    } catch (err: any) {
      toast.error(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    await addFiles(files);
  };

  const removeAttachment = useCallback((i: number) => {
    setAttachments((prev) => {
      const target = prev[i];
      if (target?.url) URL.revokeObjectURL(target.url);
      return prev.filter((_, j) => j !== i);
    });
  }, []);

  // Paste of image(s) from the clipboard attaches them like a device pick. Only images
  // are intercepted - a normal text paste falls through to the textarea untouched.
  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (!files.length) return;
    e.preventDefault();
    void addFiles(files);
  }, [addFiles]);

  // Upload a dropped folder's files under one uniquified root folder on the server and
  // attach that folder as a single chip.
  const addFolder = useCallback(async (dir: FileSystemDirectoryEntry) => {
    const files: { file: File; rel: string }[] = [];
    const walk = async (d: FileSystemDirectoryEntry, prefix: string) => {
      const reader = d.createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) {
          if (e.isDirectory) await walk(e as FileSystemDirectoryEntry, prefix + e.name + "/");
          else files.push({ file: await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)), rel: prefix + e.name });
        }
      }
    };
    setUploading(true);
    try {
      await walk(dir, "");
      if (!files.length) return;
      const root = `${dir.name}-${Math.random().toString(36).slice(2, 10)}`;
      let path = "";
      for (const { file, rel } of files) {
        const p = await uploadImage(file, `${root}/${rel}`);
        path = p.slice(0, p.length - rel.length - 1);
      }
      setAttachments((a) => [...a, { name: dir.name + "/", path, isImage: false }]);
    } catch (err: any) {
      toast.error(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  // Drop of files, images or folders onto the composer attaches them. Images go through
  // the same path as paste; a text drag falls through to the textarea untouched.
  const [dragOver, setDragOver] = useState(false);
  const onDrop = useCallback((e: React.DragEvent) => {
    setDragOver(false);
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    // Entries must be read synchronously, before the event ends.
    const files: File[] = [];
    const dirs: FileSystemDirectoryEntry[] = [];
    for (const it of Array.from(e.dataTransfer.items)) {
      if (it.kind !== "file") continue;
      const entry = it.webkitGetAsEntry?.();
      if (entry?.isDirectory) { dirs.push(entry as FileSystemDirectoryEntry); continue; }
      const f = it.getAsFile();
      if (f) files.push(f);
    }
    void (async () => {
      await addFiles(files);
      for (const d of dirs) await addFolder(d);
    })();
  }, [addFiles, addFolder]);

  // Revoke any lingering preview object URLs when the pane unmounts.
  useEffect(() => () => { attachmentsRef.current.forEach((a) => a.url && URL.revokeObjectURL(a.url)); }, []);

  // Show the status footer whenever a turn is in flight EXCEPT while the assistant is
  // actively streaming text (its blinking cursor is the indicator then). Keying off the
  // streaming flag - not just "last item is assistant" - keeps it visible in the gaps of
  // a multi-step turn (finished a text block, now calling a tool / thinking).
  const status = chatStatus(slug);
  const bg = chatBg(slug);
  const goal = chatGoal(slug);
  const lastItem = items[items.length - 1];
  const working = running && !(lastItem?.kind === "assistant" && lastItem.streaming);
  // Turn-start timestamp comes from the store (stamped at event time, so it resets every
  // turn even when renders coalesce) - for the elapsed timer.
  const since = chatSince(slug);
  const listContext = useMemo(() => ({ working, status, since, bg }), [working, status, since, bg]);

  const queue = chatQueue(slug);

  // ---- usage awareness (informational only - never acts on its own) ----
  // Last known context size, from the newest persisted usage event. This is what every
  // future message in this session will re-read, so it IS the per-message price tag.
  const lastCtx = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) { const it = items[i]; if (it.kind === "usage") return it.ctx || 0; }
    return 0;
  }, [items]);
  // "Start fresh?" banner: big session on open → offer a one-tap free reset. Dismissing
  // hides it for this pane's lifetime (it returns next app open if the session is still big).
  const [freshDismissed, setFreshDismissed] = useState(false);
  const freshBanner = hydrated && !running && !freshDismissed && lastCtx >= 150_000;

  // An open ask_user card the user hasn't answered yet. While one is pending the
  // turn is paused waiting on the tool result, so a normal "send" would queue behind
  // a turn that can't finish - instead we route the message in as a discussion reply.
  const pendingAsk = [...items].reverse().find((it) => it.kind === "ask" && !it.answered) as AskItem | undefined;

  // A question is the one arrival you don't want the bottom of. A card with several
  // options is often taller than the viewport, so the usual glue-to-bottom lands on its
  // Submit button with the question and the first options scrolled off above - you have to
  // scroll back up before you can start reading. Put its TOP in view instead, and drop the
  // bottom-follow so nothing yanks it back down. Once per question id (not on every
  // re-render while it's open), and it covers opening a chat that is already parked on one.
  const askSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingAsk) { askSeenRef.current = null; return; }
    if (askSeenRef.current === pendingAsk.id) return;
    askSeenRef.current = pendingAsk.id;
    requestAnimationFrame(() => {
      const el = scrollerNodeRef.current;
      const card = el?.querySelector<HTMLElement>(`[data-ask="${CSS.escape(pendingAsk.id)}"]`);
      if (!el || !card) return;
      pinnedRef.current = false;
      // Delta between the card's top and the scroller's, so it works regardless of what
      // the card's offsetParent happens to be.
      el.scrollTop += card.getBoundingClientRect().top - el.getBoundingClientRect().top - 12;
    });
  }, [pendingAsk?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Slash-command autocomplete: open while the draft is a bare "/word" (no space yet).
  // A guest is offered only the reset commands - the rest either reconfigure the session
  // or spend the owner's tokens, and the server refuses them anyway (see the chat WS).
  const [cmdSel, setCmdSel] = useState(0);
  const commands = guest ? SLASH_COMMANDS.filter((c) => GUEST_SLASH.has(c.cmd)) : SLASH_COMMANDS;
  const slashMatches = /^\/\w*$/.test(draft) ? commands.filter((c) => c.cmd.startsWith(draft.toLowerCase())) : [];
  const cmdIdx = slashMatches.length ? Math.min(cmdSel, slashMatches.length - 1) : 0;
  const runCommand = (cmd: string) => {
    enqueueChat(slug, cmd);
    setDraft(""); setCmdSel(0);
    if (taRef.current) taRef.current.style.height = "auto";
    requestAnimationFrame(() => scrollToBottom("smooth"));
  };

  // @-mention file picker. Active while the text right before the caret is a bare
  // "@token" (no spaces) - we fetch matching project files and let the user pick one to
  // splice its path into the message. detectMention reads the caret-anchored token.
  const [mention, setMention] = useState<{ query: string; files: string[]; sel: number } | null>(null);
  const mentionReq = useRef(0);
  const detectMention = (el: HTMLTextAreaElement) => {
    if (el.value.startsWith("!")) { setMention(null); return; }   // bash mode: @ is shell text, not a file mention
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!m) { setMention(null); return; }
    const query = m[1];
    // Preserve files + selection while the query is unchanged (so caret moves / arrow
    // nav don't wipe the open menu); only reset when the typed token actually changes.
    setMention((prev) => (prev && prev.query === query ? prev : { query, files: [], sel: 0 }));
  };
  useEffect(() => {
    if (mention == null) return;
    const seq = ++mentionReq.current;
    const id = setTimeout(async () => {
      try {
        const r = await api<{ files: string[] }>("GET", `/api/files?session=${encodeURIComponent(slug)}&q=${encodeURIComponent(mention.query)}`);
        if (seq === mentionReq.current) setMention((p) => (p ? { ...p, files: r.files, sel: 0 } : p));
      } catch { /* leave previous results */ }
    }, 140);
    return () => clearTimeout(id);
  }, [mention?.query, slug]); // eslint-disable-line react-hooks/exhaustive-deps
  const mentionIdx = mention && mention.files.length ? Math.min(mention.sel, mention.files.length - 1) : 0;
  // Picking a file splices "@<path> " inline at the caret (replacing the typed @token)
  // and records the path so the backdrop highlighter renders it as an inline tag - the
  // path lives in the text itself, like CLI file-mention UIs, so it flows with the
  // sentence and a single Backspace at its end deletes the whole token.
  const insertMention = (filePath: string) => {
    const el = taRef.current; if (!el) return;
    const pos = el.selectionStart ?? draft.length;
    const before = draft.slice(0, pos);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    const start = m ? before.length - m[1].length - 1 : pos;   // index of the '@'
    const token = "@" + filePath + " ";
    const next = draft.slice(0, start) + token + draft.slice(pos);
    setDraft(next);
    setMentionPaths((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
      autosize(el);
      syncOverlay();
    });
  };

  // Keep the backdrop highlighter aligned with the textarea's scroll position.
  const syncOverlay = () => {
    const el = taRef.current, ov = overlayRef.current;
    if (el && ov) { ov.scrollTop = el.scrollTop; ov.scrollLeft = el.scrollLeft; }
  };

  // Grow to fit, then scroll - the cap has to match the textarea's max-h class exactly,
  // or the two disagree about when scrolling starts and the caret lands off the text.
  const autosize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(COMPOSER_MAX_H, el.scrollHeight) + "px";
  };


  // Voice typing streams words into the draft as you speak (see lib/dictation.ts), so
  // dictated text lands in the same box you'd type in - editable, mentionable, sent by
  // the same button.
  const dictation = useDictation({
    getBase: () => draft,
    onUpdate: (text) => {
      setDraft(text);
      const el = taRef.current;
      if (el) autosize(el);
      requestAnimationFrame(syncOverlay);
    },
  });

  // Split the draft into plain text + highlighted @<path> tokens for the backdrop layer.
  // No horizontal padding on the token (only a tinted, slightly-rounded background) so
  // every glyph stays exactly where the textarea places it and the caret never drifts.
  const overlayContent = useMemo(() => {
    // Bash mode tints the leading "!" so the sigil reads as a mode marker rather than
    // as the first character of the command. No mentions are matched here - see detectMention.
    if (!guest && draft.startsWith("!")) return [<span key="b" className="text-warn">!</span>, draft.slice(1) + "\n"];
    if (mentionPaths.length === 0) return draft + "\n";
    const esc = [...mentionPaths].sort((a, b) => b.length - a.length).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp("@(?:" + esc.join("|") + ")", "g");
    const out: React.ReactNode[] = [];
    let last = 0, m: RegExpExecArray | null, k = 0;
    while ((m = re.exec(draft))) {
      if (m.index > last) out.push(draft.slice(last, m.index));
      out.push(<span key={k++} className="rounded-[4px] bg-accent/15 text-accent box-decoration-clone">{m[0]}</span>);
      last = m.index + m[0].length;
    }
    out.push(draft.slice(last) + "\n");
    return out;
  }, [draft, mentionPaths]);

  // Re-sync AFTER React has painted the new draft into the overlay. Doing it inline in
  // onChange syncs against the previous render: the overlay is still one line shorter
  // than the textarea, so the assignment clamps to the old scroll max and the mirror is
  // left one line behind for good - which is what made the caret drift away from the
  // text it belongs to once the composer started scrolling.
  useLayoutEffect(syncOverlay, [overlayContent]);

  // Bash mode: a leading "!" turns the composer into a shell prompt, like the CLI. The
  // command runs in the project dir without starting a turn - its output is shown as a
  // card and handed to Claude with your next message (server: runLocalBash).
  // "!" opens a raw shell on the owner's machine, so it simply isn't a mode a guest has -   // for them the character is ordinary text (the onChange rewrite is skipped to match).
  const bashMode = !guest && draft.startsWith("!");
  const bashCmd = bashMode ? draft.slice(1).trim() : "";

  const hasContent = bashMode ? bashCmd !== "" : draft.trim() !== "" || attachments.length > 0;
  const submit = () => {
    if (!hasContent) return;
    dictation.cancel();   // the draft is on its way; nothing in flight may still rewrite it
    if (bashMode) {
      sendBash(slug, bashCmd);
      setDraft("");
      if (taRef.current) taRef.current.style.height = "auto";
      requestAnimationFrame(() => scrollToBottom("smooth"));
      return;
    }
    // Strip the leading @ from committed mention tokens so Claude receives the bare path
    // inline where it was referenced; attachments follow on their own lines.
    let body = draft;
    for (const p of mentionPaths) body = body.split("@" + p).join(p);
    const text = [body.trim(), ...attachments.map((a) => a.path)].filter(Boolean).join("\n");
    if (pendingAsk) answerChat(slug, pendingAsk.id, [], text);   // discuss instead of picking
    else enqueueChat(slug, text);   // queues automatically if Claude is mid-turn
    setDraft("");
    attachments.forEach((a) => a.url && URL.revokeObjectURL(a.url));
    setAttachments([]);
    setMentionPaths([]);
    if (taRef.current) taRef.current.style.height = "auto";
    requestAnimationFrame(() => scrollToBottom("smooth"));   // jump to the newest after sending
  };

  return (
    <div className="absolute inset-0 flex flex-col" style={{ visibility: active ? "visible" : "hidden", zIndex: active ? 1 : 0 }}>
      <div className="relative flex-1 min-h-0">
        {!hydrated ? (
          <ChatSkeleton />
        ) : items.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted pointer-events-none">
            <MessageSquare size={36} strokeWidth={1.4} className="opacity-50" />
            {/* baseOf, not ===: General's extra chats are slugs like `__general__::2`, which
                an exact match missed - so every new General chat showed the project copy. */}
            <p className="text-sm">{baseOf(slug) === GENERAL_SLUG ? "Ask Claude anything" : "Chat with Claude Code in this project"}</p>
          </div>
        ) : (
          <div
            ref={(el) => { scrollerNodeRef.current = el; setScrollerEl(el); }}
            data-chat-scroller="true"
            className="h-full overflow-y-auto overscroll-contain"
          >
            <div className="h-4" />
            {items.length > tail && (
              <div className="max-w-3xl mx-auto w-full px-3.5 pb-3.5">
                <button
                  onClick={loadEarlier}
                  className="w-full py-2 rounded-xl border border-border bg-panel2 text-[12px] text-muted hover:text-fg transition-colors"
                >
                  Show {Math.min(TAIL_CHUNK, items.length - tail)} earlier messages · {items.length - tail} hidden
                </button>
              </div>
            )}
            {items.slice(-tail).map((it, i) => {
              const idx = Math.max(0, items.length - tail) + i;   // absolute index - stable across chunk reveals
              return (
                <div key={idx} className="max-w-3xl mx-auto w-full px-3.5 pb-3.5">
                  {marks.has(idx) && <TimeDivider label={marks.get(idx)!} />}
                  <Message it={it} slug={slug} onReveal={stickToBottom} />
                </div>
              );
            })}
            <ChatFooter context={listContext} />
          </div>
        )}
        {/* Fade the last messages into the background just above the composer, so text
            dissolves under the input instead of ending on a hard edge. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-bg to-transparent" />
      </div>

      <div className="shrink-0 px-3 pt-0 kb-tight" style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}>
        <div className="max-w-3xl mx-auto w-full">
          {hydrated && !connected && showReconnecting && (
            <div className="mb-1.5 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-panel border border-border text-[12px] text-muted">
              <Loader2 size={12} className="shrink-0 animate-spin" />
              <span className="min-w-0">Reconnecting…</span>
            </div>
          )}
          {/* One line, never wrapping: the size is the whole message, "Start fresh" is the
              action, and keeping the session is the do-nothing default - so it's an × to
              dismiss, not a button competing with the primary one. */}
          {freshBanner && (
            <div className="mb-1.5 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-panel border border-warn/40 text-[13px]">
              <Sparkles size={13} className="text-warn shrink-0" />
              <span className="flex-1 min-w-0 truncate text-fg/80">
                <b className="tabular-nums">~{fmtTok(lastCtx)}</b> tokens re-read every message
              </span>
              <button onClick={() => clearChat(slug)} className="shrink-0 px-2.5 h-7 rounded-md bg-accent text-bg text-[12px] font-medium hover:bg-accent2 transition-colors">Start fresh</button>
              <button onClick={() => setFreshDismissed(true)} title="Keep this session" className="shrink-0 grid place-items-center w-6 h-6 rounded-sm text-muted hover:text-fg hover:bg-panel2 transition-colors">
                <X size={13} />
              </button>
            </div>
          )}
          {goal && <GoalBar slug={slug} goal={goal} />}
          {queue.length > 0 && (
            <div className="mb-1.5 flex flex-col gap-1">
              {queue.map((q, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-panel border border-border text-[13px]">
                  <Clock3 size={13} className="text-muted shrink-0" />
                  <span className="truncate flex-1 text-fg/80">{q}</span>
                  <span className="text-[12px] text-muted shrink-0">Queued</span>
                  <button onClick={() => removeQueued(slug, i)} title="Remove" className="grid place-items-center w-6 h-6 rounded-sm text-muted hover:text-fg hover:bg-panel2 shrink-0">
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {slashMatches.length > 0 && (
            <div className="mb-1.5 rounded-xl border border-border bg-panel2 shadow-2xl shadow-black/50 overflow-hidden">
              {slashMatches.map((c, i) => (
                <button
                  key={c.cmd}
                  onClick={() => runCommand(c.cmd)}
                  onMouseEnter={() => setCmdSel(i)}
                  className={cn("w-full flex items-center gap-3 px-3 py-2 text-left transition-colors", i === cmdIdx ? "bg-panel" : "hover:bg-panel")}
                >
                  <span className="font-mono text-[13px] text-fg shrink-0">{c.cmd}</span>
                  <span className="text-[12px] text-muted truncate">{c.desc}</span>
                </button>
              ))}
            </div>
          )}
          {mention && mention.files.length > 0 && (
            <div className="mb-1.5 rounded-xl border border-border bg-panel2 shadow-2xl shadow-black/50 overflow-hidden max-h-64 overflow-y-auto">
              {mention.files.map((f, i) => {
                const slash = f.lastIndexOf("/");
                const base = slash >= 0 ? f.slice(slash + 1) : f;
                const dir = slash >= 0 ? f.slice(0, slash) : "";
                return (
                  <button
                    key={f}
                    onClick={() => insertMention(f)}
                    onMouseEnter={() => setMention((m) => (m ? { ...m, sel: i } : m))}
                    className={cn("w-full flex items-center gap-2 px-3 py-2 text-left transition-colors", i === mentionIdx ? "bg-panel" : "hover:bg-panel")}
                  >
                    <FileText size={13} className="text-muted shrink-0" />
                    <span className="text-[13px] truncate">{base}</span>
                    {dir && <span className="text-[11px] text-muted truncate ml-auto font-mono">{dir}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <div
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false); }}
            onDrop={onDrop}
            className={cn(
            "squircle rounded-2xl border bg-panel transition-colors px-3.5 pt-2.5 pb-2",
            dragOver ? "border-accent" : bashMode ? "border-warn/60 focus-within:border-warn" : "border-border focus-within:border-muted/50"
          )}>
            {bashMode && (
              <div className="flex items-center gap-1.5 pb-1.5 text-[12px] text-warn">
                <Terminal size={12} className="shrink-0" />
                <span className="font-medium">Bash mode</span>
                <span className="text-muted truncate">Claude sees the output with your next message</span>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="flex gap-2 pb-2 overflow-x-auto no-scrollbar">
                {attachments.map((a, i) =>
                  a.isImage && a.url ? (
                    <div key={"a" + i} className="relative shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-border bg-panel2">
                      <img src={a.url} alt={a.name} className="w-full h-full object-cover" />
                      <button
                        onClick={() => removeAttachment(i)}
                        title="Remove"
                        className="absolute top-0.5 right-0.5 grid place-items-center w-5 h-5 rounded-full bg-black/70 text-white hover:bg-black shadow-sm"
                      >
                        <X size={12} strokeWidth={2.5} />
                      </button>
                    </div>
                  ) : (
                    <span key={"a" + i} className="flex items-center gap-1.5 shrink-0 max-w-[200px] h-16 px-2.5 rounded-lg bg-panel2 border border-border text-[12px]">
                      <Paperclip size={13} className="text-muted shrink-0" />
                      <span className="truncate">{a.name}</span>
                      <button onClick={() => removeAttachment(i)} title="Remove" className="grid place-items-center w-4 h-4 rounded text-muted hover:text-fg shrink-0">
                        <X size={12} />
                      </button>
                    </span>
                  )
                )}
              </div>
            )}

            {/* Backdrop highlighter: a mirror layer renders the draft with @<path> tokens
                tinted as inline tags; the textarea on top has transparent text (but a
                visible caret) so the two line up glyph-for-glyph. */}
            <div className="relative">
              <div
                ref={overlayRef}
                aria-hidden
                className={cn(
                  "absolute inset-0 px-1.5 py-1 text-[14px] leading-relaxed whitespace-pre-wrap break-words overflow-hidden pointer-events-none select-none text-fg",
                  bashMode && "font-mono"
                )}
              >
                {overlayContent}
              </div>
              <textarea
              ref={taRef}
              value={draft}
              onChange={(e) => {
                let v = e.target.value;
                // Bash mode keeps the draft as "! " + command, so the sigil never touches
                // what you typed. It's a real space, not padding - the backdrop overlay
                // mirrors this text glyph-for-glyph, and padding would drift the caret.
                if (guest) { /* no bash mode for a guest - "!" stays literal text */ }
                else if (v === "!") v = draft === "! " ? "" : "! ";        // backspacing the space leaves bash mode
                else if (v.startsWith("!") && v[1] !== " ") v = "! " + v.slice(1);   // e.g. a pasted "!ls -la"
                setDraft(v); setMentionPaths((prev) => prev.filter((p) => v.includes("@" + p))); setCmdSel(0); detectMention(e.target); autosize(e.target);
              }}
              onScroll={syncOverlay}
              onPaste={onPaste}
              onTouchEnd={(e) => {
                // First tap while unfocused: iOS snapshots the caret position DURING native
                // focus processing (before focusin fires) and pans the whole layout if it's
                // near the bottom. Intercept: shrink #app first (cx-preshrink → App.tsx),
                // then focus with the composer already above the keyboard - nothing to pan.
                // Already-focused taps pass through untouched (caret placement, selection).
                if (document.activeElement === e.currentTarget) return;
                e.preventDefault();
                const ta = e.currentTarget;
                window.dispatchEvent(new Event("cx-preshrink"));
                ta.focus({ preventScroll: true });
                const len = ta.value.length;
                try { ta.setSelectionRange(len, len); } catch { /* ok */ }
              }}
              onKeyUp={(e) => detectMention(e.currentTarget)}
              onClick={(e) => detectMention(e.currentTarget)}
              onKeyDown={(e) => {
                // Escape leaves bash mode, dropping the "!" and the half-typed command.
                if (bashMode && e.key === "Escape") { e.preventDefault(); setDraft(""); e.currentTarget.style.height = "auto"; return; }
                // Backspace at the end of an @<path> token deletes the whole token at once,
                // the way CLI file-mention UIs treat a tag as a single unit.
                if (e.key === "Backspace" && e.currentTarget.selectionStart === e.currentTarget.selectionEnd) {
                  const pos = e.currentTarget.selectionStart ?? 0;
                  const before = draft.slice(0, pos);
                  const hit = mentionPaths.find((p) => before.endsWith("@" + p));
                  if (hit) {
                    e.preventDefault();
                    const start = pos - (hit.length + 1);
                    const next = draft.slice(0, start) + draft.slice(pos);
                    setDraft(next);
                    setMentionPaths((prev) => prev.filter((p) => next.includes("@" + p)));
                    const el = e.currentTarget;
                    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start, start); autosize(el); syncOverlay(); });
                    return;
                  }
                }
                // @-mention menu navigation takes priority while it's open.
                if (mention && mention.files.length > 0) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setMention((m) => (m ? { ...m, sel: (mentionIdx + 1) % m.files.length } : m)); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setMention((m) => (m ? { ...m, sel: (mentionIdx - 1 + m.files.length) % m.files.length } : m)); return; }
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); insertMention(mention.files[mentionIdx]); return; }
                  if (e.key === "Tab") { e.preventDefault(); insertMention(mention.files[mentionIdx]); return; }
                  if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
                }
                // Slash-command menu navigation takes priority while it's open.
                if (slashMatches.length > 0) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setCmdSel((s) => (s + 1) % slashMatches.length); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setCmdSel((s) => (s - 1 + slashMatches.length) % slashMatches.length); return; }
                  if (e.key === "Tab") { e.preventDefault(); setDraft(slashMatches[cmdIdx].cmd + " "); setCmdSel(0); return; }
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runCommand(slashMatches[cmdIdx].cmd); return; }
                }
                // Enter sends only on desktop (with a physical keyboard). On mobile,
                // Enter inserts a newline - you send with the button.
                if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={bashMode ? "" : dictation.listening ? "Listening…" : dictation.starting ? "Starting the recogniser…" : pendingAsk ? "Reply to discuss, or pick an option above…" : "Message…"}
              rows={1}
              spellCheck={false}
              // no-scrollbar is load-bearing, not cosmetic: the global themed scrollbar is
              // 10px wide, so once the draft outgrew the box the textarea's text column
              // narrowed by 10px while the mirror below it stayed full width. The two then
              // wrapped at different words and every line after the first drifted further
              // out of register, leaving the caret nowhere near the glyph it was on.
              className={cn(
                "relative w-full resize-none overflow-y-auto no-scrollbar bg-transparent px-1.5 py-1 text-[14px] leading-relaxed outline-none text-transparent placeholder:text-muted",
                bashMode ? "font-mono caret-warn" : "caret-fg"
              )}
              style={{ maxHeight: COMPOSER_MAX_H }}
              />
            </div>

            <div className="flex items-center justify-between pt-1.5">
              <input ref={fileRef} type="file" multiple className="hidden" onChange={onPick} />
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => fileRef.current?.click()}
                  title="Attach file or image"
                  className="grid place-items-center w-8 h-8 rounded-md text-muted hover:text-fg hover:bg-panel2 transition-colors"
                >
                  {uploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={20} />}
                </button>
                {/* The model is the owner's choice and bills to the owner's plan, so a
                    share doesn't get a picker. */}
                {!guest && <ModelPill slug={slug} />}
              </div>

              <div className="flex items-center gap-1.5">
                {dictation.supported && (
                  <button
                    onClick={dictation.toggle}
                    title={dictation.starting ? "Starting…" : dictation.listening ? "Stop dictation" : "Voice typing"}
                    className={cn(
                      "relative grid place-items-center w-8 h-8 rounded-md transition-colors",
                      dictation.listening ? "bg-danger/15 text-danger hover:bg-danger/25" : "text-muted hover:text-fg hover:bg-panel2"
                    )}
                  >
                    {dictation.listening && <span className="absolute inset-0 rounded-md bg-danger/20 animate-ping" />}
                    {/* Fixed, even-sized slot: at an odd icon size the spinner's centre lands
                        on a half pixel and each rotation frame rasterises a step off, which
                        reads as a wobble. Spin the square wrapper, not the glyph. */}
                    <span className={cn("relative grid place-items-center w-[18px] h-[18px]", dictation.starting && "animate-spin")}>
                      {dictation.starting ? <Loader2 size={16} /> : <Mic size={16} />}
                    </span>
                  </button>
                )}
                {running && (
                  <button onClick={() => stopChat(slug)} title="Stop" className="grid place-items-center w-8 h-8 rounded-md bg-danger/15 text-danger hover:bg-danger/25 transition-colors">
                    <Square size={15} fill="currentColor" />
                  </button>
                )}
                {hasContent && (
                  <button onClick={submit} title={bashMode ? "Run command" : pendingAsk ? "Send reply" : running ? "Queue message" : "Send"}
                    className={cn(
                      "grid place-items-center w-8 h-8 rounded-md text-bg active:scale-95 transition-all",
                      bashMode ? "bg-warn hover:bg-warn2" : "bg-accent hover:bg-accent2"
                    )}>
                    {bashMode ? <Terminal size={16} strokeWidth={2.5} /> : <ArrowUp size={18} strokeWidth={2.5} />}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatView() {
  const openSlugs = useStore((s) => s.openSlugs);
  const active = useStore((s) => s.active);
  const mode = useStore((s) => s.mode);
  return (
    <>
      {openSlugs.filter((s) => (mode[s] || "chat") === "chat").map((slug) => (
        <ChatPane key={slug} slug={slug} active={slug === active} />
      ))}
    </>
  );
}
