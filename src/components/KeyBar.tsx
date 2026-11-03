import { useStore } from "@/store/store";
import * as terminals from "@/lib/terminals";
import { cn } from "@/lib/utils";

const ESC = "\x1b";
const KEYS: { label: string; seq: string; wide?: boolean; danger?: boolean; accent?: boolean }[] = [
  { label: "esc", seq: ESC },
  { label: "tab", seq: "\t", wide: true },
  { label: "⇧tab", seq: ESC + "[Z", wide: true },
  { label: "/", seq: "/" },
  { label: "←", seq: ESC + "[D", accent: true },
  { label: "↑", seq: ESC + "[A", accent: true },
  { label: "↓", seq: ESC + "[B", accent: true },
  { label: "→", seq: ESC + "[C", accent: true },
  { label: "⌃c", seq: "\x03", wide: true, danger: true },
];

export function KeyBar() {
  const active = useStore((s) => s.active);
  if (!active) return null;
  return (
    <div className="md:hidden flex gap-1.5 px-2 py-2 overflow-x-auto no-scrollbar border-t border-border bg-panel kb-tight"
      style={{ paddingBottom: "calc(1.75rem + env(safe-area-inset-bottom))" }}>
      {KEYS.map((k) => (
        <button
          key={k.label}
          onClick={() => { terminals.input(active, k.seq); terminals.focus(active); }}
          className={cn(
            "shrink-0 h-11 grid place-items-center rounded-lg font-mono text-sm border border-border",
            "bg-panel2 active:scale-95 active:bg-border transition-transform",
            k.wide ? "min-w-[58px] text-xs" : "min-w-[46px]",
            k.danger && "text-danger",
            k.accent && "text-accent2 min-w-[42px]",
          )}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
