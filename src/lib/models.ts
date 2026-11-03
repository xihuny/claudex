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
}

export const MODEL_CHOICES: ModelChoice[] = [
  { alias: "fable", family: "fable", label: "Fable 5.1", desc: "For your toughest challenges", oneM: true },
  { alias: "opus", family: "opus", label: "Opus 5.5", desc: "For complex tasks", oneM: true },
  { alias: "sonnet", family: "sonnet", label: "Sonnet 5", desc: "Most efficient for everyday tasks", oneM: true },
  { alias: "haiku", family: "haiku", label: "Haiku 4.5", desc: "Fastest for quick answers", oneM: false },
];

/** CLI effort levels, in the order the picker shows them. `note` is the usage warning. */
export const EFFORT_CHOICES = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High", isDefault: true },
  { id: "xhigh", label: "Extra" },
  { id: "max", label: "Max", note: "1.5× or more usage" },
] as const;

export type EffortId = (typeof EFFORT_CHOICES)[number]["id"];

export const EFFORT_HINT =
  "Higher effort means more thorough responses, but takes longer and uses your limits faster.";

export function effortLabel(e: string | null | undefined): string | null {
  if (!e) return null;
  return EFFORT_CHOICES.find((c) => c.id === e)?.label ?? e;
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
