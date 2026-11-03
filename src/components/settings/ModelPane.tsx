// ── Model settings ───────────────────────────────────────────────────────────
//
// The default model and effort level for NEW chats. Without a pick here a fresh
// session rides whatever Anthropic currently resolves as the plan default, which
// changes without warning; with one, the server passes --model/--effort on every
// spawn for any session that hasn't made its own /model pick in the composer.
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card, Note, Toggle } from "@/components/settings/parts";
import { MODEL_CHOICES, EFFORT_CHOICES, EFFORT_HINT, modelFamily, modelLabelFor } from "@/lib/models";
import { cn } from "@/lib/utils";

interface Config {
  defaultModel: string | null;
  defaultEffort: string | null;
  /** What the server would actually use right now, pick or not - shown as the fallback. */
  model: string | null;
}

function Option({ label, desc, note, on, onClick }: {
  label: string; desc?: string; note?: string; on: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-panel2/60 transition-colors"
    >
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className={cn("text-[14px] truncate", on ? "text-fg font-medium" : "text-fg/85")}>{label}</span>
          {note && <span className="text-[11px] text-warn whitespace-nowrap">{note}</span>}
        </span>
        {desc && <span className="block text-[11px] text-muted truncate">{desc}</span>}
      </span>
      {on && <Check size={15} className="text-accent shrink-0" />}
    </button>
  );
}

export function ModelPane() {
  const [cfg, setCfg] = useState<Config | null>(null);

  useEffect(() => { (async () => { try { setCfg(await api<Config>("GET", "/api/config")); } catch {} })(); }, []);

  const save = async (patch: Partial<Config>) => {
    try { setCfg(await api<Config>("POST", "/api/config", patch)); }
    catch (e) { toast.error((e as Error).message); }
  };

  const picked = cfg?.defaultModel || "";
  const fam = modelFamily(picked);
  const oneM = picked.includes("[1m]");
  const famOneM = MODEL_CHOICES.find((m) => m.family === fam)?.oneM ?? false;

  const pickModel = (alias: string | null) => {
    if (!alias) return save({ defaultModel: "" });
    const supports = MODEL_CHOICES.find((m) => m.alias === alias)?.oneM;
    save({ defaultModel: supports && oneM ? alias + "[1m]" : alias });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <Card title="Default model" hint="Used by new chats">
        <Option
          label="Plan default"
          desc={cfg?.model ? `Currently ${modelLabelFor(cfg.model)}` : "Whatever Claude resolves at session start"}
          on={!picked}
          onClick={() => pickModel(null)}
        />
        {MODEL_CHOICES.map((m) => (
          <Option
            key={m.alias}
            label={m.label}
            desc={m.desc}
            on={fam === m.family}
            onClick={() => pickModel(m.alias)}
          />
        ))}
        {famOneM && (
          <Toggle
            label="1M context window"
            desc="Bigger window, higher per-token cost"
            on={oneM}
            onChange={(v) => save({ defaultModel: fam ? (v ? fam + "[1m]" : fam) : "" })}
          />
        )}
      </Card>

      <Card title="Default effort" hint={EFFORT_HINT}>
        <Option
          label="Plan default"
          desc="Leave the effort level to Claude"
          on={!cfg?.defaultEffort}
          onClick={() => save({ defaultEffort: "" })}
        />
        {EFFORT_CHOICES.map((e) => (
          <Option
            key={e.id}
            label={e.label}
            note={"note" in e ? e.note : undefined}
            on={cfg?.defaultEffort === e.id}
            onClick={() => save({ defaultEffort: e.id })}
          />
        ))}
      </Card>

      <Note>
        A chat that picked its own model or effort in the composer keeps that pick. Chats
        already running switch over when their process next restarts.
      </Note>
    </div>
  );
}
