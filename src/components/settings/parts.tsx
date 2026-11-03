// Shared building blocks for the settings screen and the VPS guide.
// Deliberately dumb + presentational: every stateful decision lives in the pane.
import { useState } from "react";
import { Check, Copy, AlertTriangle, Lightbulb, Info, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** A titled group of rows. The title is optional so it can wrap a bare card too. */
export function Card({ title, hint, children, className }: {
  title?: string; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn("rounded-2xl bg-panel overflow-hidden", className)}>
      {title && (
        <div className="flex items-baseline justify-between gap-2 px-4 pt-3.5 pb-1">
          <h3 className="text-[14px] font-medium text-fg">{title}</h3>
          {hint && <span className="text-[12px] text-muted tabular-nums">{hint}</span>}
        </div>
      )}
      <div className="px-2 pb-2">{children}</div>
    </section>
  );
}

/** One settings line: status dot, label + description, and a trailing control. */
export function Row({ ok, title, desc, children, mono }: {
  ok?: boolean; title: string; desc?: string; children?: React.ReactNode; mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
      {ok !== undefined && (
        <span className={cn("grid place-items-center w-[18px] h-[18px] rounded-full shrink-0 border transition-colors",
          ok ? "bg-accent border-accent text-bg" : "border-border")}>
          {ok && <Check size={12} strokeWidth={3} />}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[14px] truncate">{title}</div>
        {desc && <div className={cn("text-[12px] text-muted truncate", mono && "font-mono")}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/** iOS-style switch. */
export function Toggle({ label, desc, on, onChange, disabled }: {
  label: string; desc?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      className="w-full flex items-center justify-between gap-3 px-2 py-2 rounded-lg text-left disabled:opacity-40 hover:bg-panel2/60 transition-colors"
    >
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-fg truncate">{label}</span>
        {desc && <span className="block text-[12px] text-muted truncate">{desc}</span>}
      </span>
      <span className={cn("relative shrink-0 w-[34px] h-[20px] rounded-full transition-colors", on ? "bg-accent" : "bg-border")}>
        <span className={cn("absolute top-[3px] left-[3px] w-[14px] h-[14px] rounded-full bg-white transition-transform", on && "translate-x-[14px]")} />
      </span>
    </button>
  );
}

/** Big tappable entry on the settings hub. */
export function HubCard({ icon: Icon, title, desc, chip, tone = "muted", onClick }: {
  icon: LucideIcon; title: string; desc: string; chip?: string;
  tone?: "ok" | "warn" | "muted"; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group w-full flex items-center gap-3 px-3.5 py-3 rounded-xl bg-panel text-left
                 transition-colors hover:bg-panel2 active:scale-[0.995]"
    >
      <span className="grid place-items-center w-6 h-6 shrink-0 text-muted group-hover:text-fg transition-colors">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-medium truncate">{title}</span>
        <span className="block text-[12px] text-muted truncate">{desc}</span>
      </span>
      {chip && (
        <span className={cn("shrink-0 text-[11px] font-medium tabular-nums px-1.5 py-0.5 rounded-xs",
          tone === "ok" ? "text-accent bg-accent/10"
            : tone === "warn" ? "text-warn bg-warn/10"
              : "text-muted bg-panel2")}>{chip}</span>
      )}
      <ChevronRight size={16} className="shrink-0 text-muted/60 group-hover:text-muted transition-colors" />
    </button>
  );
}

/** Copyable shell/config snippet. Long lines scroll rather than wrap. */
/** Copy-to-clipboard button with a transient confirmation tick. */
function CopyBtn({ text, title = "Copy", className, size = 13 }: {
  text: string; title?: string; className?: string; size?: number;
}) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };
  return (
    <button
      onClick={copy} title={title} aria-label={title}
      className={cn("grid place-items-center rounded-md shrink-0 transition-colors",
        copied ? "bg-accent/15 text-accent" : "text-muted hover:text-fg hover:bg-panel2",
        className)}
    >
      {copied ? <Check size={size} strokeWidth={3} /> : <Copy size={size} />}
    </button>
  );
}

type CmdLine =
  | { kind: "cmd"; cmd: string; comment?: string }
  | { kind: "comment"; text: string }
  | { kind: "gap" };

/** Split a shell snippet into individually copyable commands.
 *  A trailing `# …` is shown but never copied; it's only detached when the quotes
 *  before it balance, so a `#` inside a quoted string stays part of the command. */
function parseCommands(code: string): CmdLine[] {
  return code.split("\n").map<CmdLine>((raw) => {
    const line = raw.trimEnd();
    if (!line.trim()) return { kind: "gap" };
    if (line.trimStart().startsWith("#")) return { kind: "comment", text: line.trim().replace(/^#\s?/, "") };
    const at = line.search(/\s+#/);
    if (at > 0) {
      const head = line.slice(0, at);
      const balanced = (s: string, q: string) => (s.split(q).length - 1) % 2 === 0;
      if (balanced(head, "'") && balanced(head, '"')) {
        return { kind: "cmd", cmd: head.trimEnd(), comment: line.slice(at).trim().replace(/^#\s?/, "") };
      }
    }
    return { kind: "cmd", cmd: line };
  });
}

/**
 * A snippet you're meant to run. Shell blocks break into one row per command, each with
 * its own copy button (plus a copy-all when there's more than one) - on a phone, next to
 * an SSH session, picking commands off one at a time is the whole job. Blocks with a
 * `file` are file *contents*, so they stay a single copyable unit.
 */
export function CodeBlock({ code, file }: { code: string; file?: string }) {
  if (file) {
    return (
      <div className="rounded-xl border border-border bg-bg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/70">
          <span className="flex-1 min-w-0 text-[12px] font-mono text-muted truncate">{file}</span>
          <CopyBtn text={code} title="Copy file contents" className="w-6 h-6" size={12} />
        </div>
        <pre className="overflow-x-auto px-3 py-2.5 text-[12px] leading-[1.65] font-mono text-fg/90">{code}</pre>
      </div>
    );
  }

  const lines = parseCommands(code);
  const cmds = lines.filter((l): l is Extract<CmdLine, { kind: "cmd" }> => l.kind === "cmd");

  return (
    <div className="rounded-xl border border-border bg-bg overflow-hidden">
      {cmds.length > 1 && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-border/70">
          <span className="flex-1 text-[12px] text-muted">
            {cmds.length} commands
          </span>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(cmds.map((c) => c.cmd).join("\n"))
                .then(() => toast.success("All commands copied")).catch(() => {});
            }}
            className="shrink-0 inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-[12px] text-muted hover:text-fg hover:bg-panel2 transition-colors"
          >
            <Copy size={11} /> Copy all
          </button>
        </div>
      )}
      <div className="py-1">
        {lines.map((l, i) => {
          if (l.kind === "gap") return <div key={i} className="h-2" />;
          if (l.kind === "comment") {
            return (
              <div key={i} className="px-3 py-0.5 text-[12px] font-mono text-muted leading-[1.6]">
                <span className="select-none opacity-60"># </span>{l.text}
              </div>
            );
          }
          return (
            <div key={i} className="group flex items-start gap-2 pl-3 pr-1.5 py-[3px] hover:bg-panel2/40 transition-colors">
              <span className="select-none shrink-0 text-[12px] font-mono leading-[1.65] text-muted">$</span>
              <span className="flex-1 min-w-0 overflow-x-auto">
                <code className="block whitespace-pre text-[12px] leading-[1.65] font-mono text-fg/90">{l.cmd}</code>
                {l.comment && (
                  <span className="block text-[11px] leading-snug text-muted pb-0.5">{l.comment}</span>
                )}
              </span>
              <CopyBtn text={l.cmd} title="Copy this command" className="w-6 h-6 opacity-70 group-hover:opacity-100" size={12} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const NOTE_STYLES = {
  warn: { icon: AlertTriangle, cls: "border-warn/30 bg-warn/[0.07] text-fg/90", ic: "text-warn" },
  tip: { icon: Lightbulb, cls: "border-border bg-panel text-fg/90", ic: "text-muted" },
  info: { icon: Info, cls: "border-border bg-panel text-muted", ic: "text-muted" },
} as const;

export function Note({ kind = "info", children }: { kind?: keyof typeof NOTE_STYLES; children: React.ReactNode }) {
  const { icon: Icon, cls, ic } = NOTE_STYLES[kind];
  return (
    <div className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed", cls)}>
      <Icon size={14} className={cn("shrink-0 mt-[2px]", ic)} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Small comparison / lookup table. Scrolls sideways on narrow screens. */
export function MiniTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="text-left font-normal text-muted px-2.5 py-1.5 whitespace-nowrap border-b border-border">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              {r.map((c, j) => (
                <td key={j} className={cn("px-2.5 py-1.5 align-top", j === 0 ? "text-fg/90 whitespace-nowrap" : "text-muted")}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Inline `code` and **bold** - the only two marks the guide uses. Returned as nodes
 * rather than a wrapper element so notes, list items and prose can all share it; the
 * code span is translucent so it reads correctly on both muted and coloured backgrounds.
 */
export function inline(text: string): React.ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
      return <code key={i} className="font-mono text-[0.92em] rounded-xs px-1 py-[1px] bg-fg/[0.08] text-fg/90">{p.slice(1, -1)}</code>;
    }
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      return <strong key={i} className="font-semibold text-fg/90">{p.slice(2, -2)}</strong>;
    }
    return <span key={i}>{p}</span>;
  });
}

/** A paragraph of guide prose. */
export function RichText({ text }: { text: string }) {
  return <p className="text-[14px] leading-relaxed text-muted">{inline(text)}</p>;
}
