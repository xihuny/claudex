// The interactive VPS deployment guide: a vertical stepper with per-step progress,
// live placeholder substitution, and copy-ready commands. Progress and values live in
// localStorage - this is a checklist you come back to across days, not a wizard.
import { useMemo, useState } from "react";
import { AnimatePresence, m as motion } from "motion/react";
import { Check, ChevronDown, Copy, RotateCcw, Sliders } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CodeBlock, MiniTable, Note, RichText, inline } from "@/components/settings/parts";
import {
  ALL_STEP_IDS, DEFAULT_VARS, DONE_KEY, PHASES, VARS_KEY, VAR_FIELDS,
  fill, loadDoneIds, stepCommands, type GuideStep, type Vars,
} from "@/components/settings/guide";

function loadDone(): Set<string> {
  return new Set(loadDoneIds());
}
function loadVars(): Vars {
  try { return { ...DEFAULT_VARS, ...JSON.parse(localStorage.getItem(VARS_KEY) || "{}") }; } catch { return DEFAULT_VARS; }
}

export function VpsGuide() {
  const [done, setDone] = useState<Set<string>>(loadDone);
  const [vars, setVars] = useState<Vars>(loadVars);
  const [openStep, setOpenStep] = useState<string | null>(() => {
    const d = loadDone();
    return ALL_STEP_IDS.find((id) => !d.has(id)) ?? null;
  });
  const [varsOpen, setVarsOpen] = useState(false);

  const v = (s: string) => fill(s, vars);
  const total = ALL_STEP_IDS.length;
  const count = done.size;

  const toggleDone = (id: string) => {
    setDone((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem(DONE_KEY, JSON.stringify([...next]));
      // Finishing a step walks you to the next unfinished one - the checklist keeps moving.
      if (!prev.has(id)) setOpenStep(ALL_STEP_IDS.find((s) => s !== id && !next.has(s)) ?? null);
      return next;
    });
  };

  const setVar = (k: keyof Vars, val: string) => {
    setVars((prev) => {
      const next = { ...prev, [k]: val };
      localStorage.setItem(VARS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const reset = () => {
    setDone(new Set());
    localStorage.removeItem(DONE_KEY);
    setOpenStep(ALL_STEP_IDS[0]);
    toast.success("Progress reset");
  };

  return (
    <div className="flex flex-col gap-3">
      {/* ── overview ───────────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-panel px-4 py-3.5">
        <p className="text-[14px] leading-relaxed text-muted">
          Run Claudex 24/7 on your own Linux box - public HTTPS over an outbound Cloudflare
          tunnel, PM2 keeping it alive across reboots, previews on stable subdomains.
        </p>
        <div className="mt-3 flex items-center gap-2.5">
          <div className="flex-1 h-1.5 rounded-full bg-panel2 overflow-hidden">
            <motion.div
              className="h-full bg-accent"
              animate={{ width: `${(count / total) * 100}%` }}
              transition={{ type: "spring", stiffness: 200, damping: 26 }}
            />
          </div>
          <span className="text-[12px] text-muted tabular-nums shrink-0">{count}/{total}</span>
          {count > 0 && (
            <button onClick={reset} title="Reset progress"
              className="grid place-items-center w-6 h-6 rounded-md text-muted/70 hover:text-fg hover:bg-panel2 transition-colors">
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── your values ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-panel overflow-hidden">
        <button onClick={() => setVarsOpen((o) => !o)}
          className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-panel2/50 transition-colors">
          <Sliders size={16} className="text-muted shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-[14px] font-medium">Your values</span>
            <span className="block text-[12px] text-muted truncate font-mono">
              {vars.user}@{vars.ip} · {vars.tunnel}.{vars.domain}
            </span>
          </span>
          <ChevronDown size={15} className={cn("shrink-0 text-muted transition-transform", varsOpen && "rotate-180")} />
        </button>
        <AnimatePresence initial={false}>
          {varsOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }} className="overflow-hidden"
            >
              <div className="px-3.5 pb-3.5 pt-0.5 grid gap-2.5 sm:grid-cols-2">
                {VAR_FIELDS.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1">
                    <span className="text-[12px] font-medium text-fg">
                      {f.label} <span className="font-normal text-muted">· {f.hint}</span>
                    </span>
                    <input
                      value={vars[f.key]}
                      onChange={(e) => setVar(f.key, e.target.value.trim())}
                      placeholder={f.placeholder}
                      spellCheck={false} autoCapitalize="off" autoCorrect="off"
                      className="w-full h-9 rounded-md bg-bg border border-border px-2.5 text-[13px] font-mono text-fg
                                 placeholder:text-muted outline-none transition-colors
                                 focus:border-muted/70 focus:ring-2 focus:ring-fg/10"
                    />
                  </label>
                ))}
              </div>
              <div className="px-3.5 pb-3.5">
                <Note kind="tip">
                  Every command below uses these values. The tunnel name doubles as this
                  host's subdomain.
                </Note>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── phases ─────────────────────────────────────────────────────────── */}
      {PHASES.map((phase, pi) => {
        const pDone = phase.steps.filter((s) => done.has(s.id)).length;
        const complete = pDone === phase.steps.length;
        return (
          <section key={phase.id} className="rounded-2xl bg-panel overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/60">
              <span className={cn("grid place-items-center w-6 h-6 shrink-0 transition-colors",
                complete ? "text-accent" : "text-muted")}>
                <phase.icon size={16} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-semibold truncate">
                  <span className="text-muted tabular-nums mr-1.5">{pi + 1}</span>{phase.title}
                </span>
                <span className="block text-[12px] text-muted truncate">{phase.desc}</span>
              </span>
              <span className={cn("shrink-0 text-[11px] tabular-nums px-1.5 py-0.5 rounded-xs",
                complete ? "text-accent bg-accent/10" : "text-muted bg-panel2")}>
                {pDone}/{phase.steps.length}
              </span>
            </div>
            <div className="px-1.5 py-1.5 flex flex-col">
              {phase.steps.map((step, si) => (
                <StepRow
                  key={step.id}
                  step={step}
                  index={si + 1}
                  last={si === phase.steps.length - 1}
                  done={done.has(step.id)}
                  open={openStep === step.id}
                  onToggle={() => setOpenStep((o) => (o === step.id ? null : step.id))}
                  onDone={() => toggleDone(step.id)}
                  v={v}
                  vars={vars}
                />
              ))}
            </div>
          </section>
        );
      })}

      <p className="px-1 pb-1 text-[11px] text-muted/70 leading-relaxed">
        The long-form version of this guide lives in the repo at{" "}
        <code className="font-mono text-fg/70">CLAUDEX_VPS_SETUP.md</code>.
      </p>
    </div>
  );
}

function StepRow({ step, index, last, done, open, onToggle, onDone, v, vars }: {
  step: GuideStep; index: number; last: boolean; done: boolean; open: boolean;
  onToggle: () => void; onDone: () => void; v: (s: string) => string; vars: Vars;
}) {
  const cmds = useMemo(() => stepCommands(step, vars), [step, vars]);
  const copyAll = () => {
    navigator.clipboard?.writeText(cmds).then(() => toast.success("Commands copied")).catch(() => {});
  };

  return (
    <div className="relative">
      {/* rail connecting the step markers */}
      {!last && <span className={cn("absolute left-[19px] top-[30px] bottom-0 w-px", done ? "bg-accent/30" : "bg-border")} />}
      <button
        onClick={onToggle}
        className="relative w-full flex items-start gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-panel2/60 transition-colors"
      >
        <span className={cn("grid place-items-center w-[22px] h-[22px] rounded-full shrink-0 border text-[11px] font-semibold tabular-nums transition-colors z-10",
          done ? "bg-accent border-accent text-bg" : open ? "border-fg/50 text-fg bg-bg" : "border-border text-muted bg-bg")}>
          {done ? <Check size={12} strokeWidth={3} /> : index}
        </span>
        <span className="flex-1 min-w-0 pt-[1px]">
          <span className={cn("block text-[14px] truncate transition-colors", done && !open && "text-muted line-through decoration-muted/40")}>
            {v(step.title)}
          </span>
          <span className="block text-[12px] text-muted truncate">{v(step.sub)}</span>
        </span>
        <span className="shrink-0 flex items-center gap-1.5 pt-[3px]">
          <span className="text-[11px] text-muted tabular-nums hidden sm:inline">{step.time}</span>
          <ChevronDown size={14} className={cn("text-muted transition-transform", open && "rotate-180")} />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden"
          >
            <div className="pl-[34px] pr-2 pb-3 pt-0.5 flex flex-col gap-2.5">
              {step.blocks.map((b, i) => {
                switch (b.t) {
                  case "p":
                    return <RichText key={i} text={v(b.text)} />;
                  case "list":
                    return (
                      <ul key={i} className="flex flex-col gap-1">
                        {b.items.map((it, j) => (
                          <li key={j} className="flex gap-2 text-[14px] leading-relaxed text-muted">
                            <span className="text-muted shrink-0 mt-[1px]">–</span>
                            <span className="min-w-0">{inline(v(it))}</span>
                          </li>
                        ))}
                      </ul>
                    );
                  case "code":
                    return <CodeBlock key={i} code={v(b.code)} file={b.file && v(b.file)} />;
                  case "note":
                    return <Note key={i} kind={b.kind}>{inline(v(b.text))}</Note>;
                  case "table":
                    return <MiniTable key={i} head={b.head.map(v)} rows={b.rows.map((r) => r.map(v))} />;
                }
              })}

              <div className="flex items-center gap-2 pt-0.5">
                <button
                  onClick={onDone}
                  className={cn("inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-medium border transition-colors",
                    done ? "border-accent/40 bg-accent/10 text-accent" : "border-border bg-panel2 text-fg hover:bg-border")}
                >
                  <Check size={12} strokeWidth={3} />
                  {done ? "Done" : "Mark as done"}
                </button>
                {cmds && (
                  <button
                    onClick={copyAll}
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] border border-border bg-panel2 text-muted hover:text-fg hover:bg-border transition-colors"
                  >
                    <Copy size={12} /> Copy all commands
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
