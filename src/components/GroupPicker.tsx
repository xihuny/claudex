import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useStore } from "@/store/store";
import { Input, Field } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

/** Pick one of the groups already in use, or type a new one. Matching is case-insensitive
 *  (the server snaps a typed name onto an existing group's casing), so picking a pill and
 *  typing the same name differ only in keystrokes. */
export function GroupPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const projects = useStore((s) => s.projects);
  const groups = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of projects) {
      const g = (p.group || "").trim();
      if (g && !seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
    }
    return [...seen.values()];
  }, [projects]);

  const current = value.trim().toLowerCase();
  const matched = groups.find((g) => g.toLowerCase() === current);
  // Free-text mode: opened by hand, or entered automatically when the project already
  // carries a group that no longer exists on any other project.
  const [typing, setTyping] = useState(false);
  const custom = typing || (!!current && !matched);

  return (
    <Field label="Group" hint="(optional)" plain>
      <div className="flex flex-wrap gap-1.5">
        <Pill active={!current && !custom} onClick={() => { setTyping(false); onChange(""); }}>None</Pill>
        {groups.map((g) => (
          <Pill key={g} active={!typing && matched === g} onClick={() => { setTyping(false); onChange(g); }}>
            <span className="truncate">{g}</span>
          </Pill>
        ))}
        <Pill active={custom} onClick={() => { setTyping(true); onChange(""); }}>
          <Plus size={13} /> New group
        </Pill>
      </div>
      {custom && (
        <Input autoFocus value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={groups.length ? "New group name" : "e.g. Work, Personal"} className="h-10 text-sm" />
      )}
    </Field>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        "flex items-center gap-1 h-8 px-3 rounded-md border text-[13px] transition-colors max-w-[180px]",
        active ? "bg-panel2 border-fg/40 text-fg font-medium" : "bg-panel2 border-transparent text-muted hover:text-fg",
      )}>
      {children}
    </button>
  );
}
