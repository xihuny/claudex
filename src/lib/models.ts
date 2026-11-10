// Model + effort metadata, shared by the composer's model pill and the Settings pane
// that picks the defaults for new chats. The CLI only ever reports raw ids
// ("claude-opus-5"); friendly names are the client's job.

export interface ModelChoice {
  alias: string;
  family: string;
  label: string;
  desc: string;
  /** Whether the family has a 1M-context variant ("opus[1m]"). */
  oneM: boolean;
  /** Usage multiplier of "max" effort on this model, shown as the Max warning. */
  maxX: string;
  /** Effort the model runs at when none is picked; the menu marks it Recommended. */
  defEffort: string;
}

export const MODEL_CHOICES: ModelChoice[] = [
  { alias: "fable", family: "fable", label: "Fable 5.2", desc: "For your toughest challenges", oneM: true, maxX: "3.5×", defEffort: "medium" },
  { alias: "opus", family: "opus", label: "Opus 5.5", desc: "For complex tasks", oneM: true, maxX: "4×", defEffort: "medium" },
  { alias: "sonnet", family: "sonnet", label: "Sonnet 5.5", desc: "Most efficient for everyday tasks", oneM: true, maxX: "5×", defEffort: "medium" },
  { alias: "haiku", family: "haiku", label: "Haiku 5.5", desc: "Fastest for quick answers", oneM: false, maxX: "8×", defEffort: "medium" },
];

/** CLI effort levels, in the order the picker shows them. `note` is the usage warning. */
export const EFFORT_CHOICES = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra" },
  { id: "max", label: "Max", note: "1.5× or more usage" },
] as const;

export type EffortId = (typeof EFFORT_CHOICES)[number]["id"];

/** `/advisor` choices, from the CLI's own usage line: /advisor <fable|opus|sonnet|off>. */
export const ADVISOR_CHOICES = [
  { id: "off", label: "No advisor" },
  { id: "fable", label: "Fable" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
] as const;

export const ADVISOR_HINT =
  "A stronger model Claude consults at key moments. Its tokens bill at its own rates. Applies to all sessions.";

export const EFFORT_HINT =
  "Higher effort means more thorough responses, but takes longer and uses your limits faster.";

export function effortLabel(e: string | null | undefined): string | null {
  if (!e) return null;
  return EFFORT_CHOICES.find((c) => c.id === e)?.label ?? e;
}

/** The effort row's warning, with the max multiplier of the model family when known. */
export function effortNote(e: (typeof EFFORT_CHOICES)[number], fam: string | null): string | undefined {
  if (!("note" in e)) return undefined;
  const x = MODEL_CHOICES.find((m) => m.family === fam)?.maxX;
  return x ? x + " or more usage" : e.note;
}

export function modelFamily(s: string | null | undefined): string | null {
  const m = String(s || "").toLowerCase();
  for (const f of ["fable", "opus", "sonnet", "haiku"]) if (m.includes(f)) return f;
  return null;
}

/** "claude-opus-5" → "Opus 5", "claude-haiku-4-5-20251001" → "Haiku 4.5". */
export function modelLabelFor(src: string | null | undefined): string {
  const s = String(src || "");
  const fam = modelFamily(s);
  if (!fam) return s ? s.replace(/^claude-/, "") : "Default";
  const v = s.match(/(?:fable|opus|sonnet|haiku)-(\d+)(?:-(\d))?/);
  if (v) return fam[0].toUpperCase() + fam.slice(1) + " " + v[1] + (v[2] ? "." + v[2] : "");
  return MODEL_CHOICES.find((r) => r.family === fam)?.label || fam;
}
