// ── API billing ──────────────────────────────────────────────────────────────
//
// Manual switch from the subscription to an Anthropic API key. The key is stored on the
// server only; this pane never receives it back, just whether one is set and its last 4.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api";
import { Card, Note, Row, Toggle } from "@/components/settings/parts";

interface Spend { usd: number; turns: number; }
export interface Billing {
  hasKey: boolean; last4: string; enabled: boolean;
  today: Spend; week: Spend; month: Spend;
}

const usd = (n: number) => "$" + (n < 10 ? n.toFixed(2) : n.toFixed(1));

export function BillingPane() {
  const [b, setB] = useState<Billing | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { (async () => { try { setB(await api<Billing>("GET", "/api/apikey")); } catch {} })(); }, []);

  const run = async (fn: () => Promise<Billing>) => {
    setBusy(true);
    try { setB(await fn()); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
    finally { setBusy(false); }
  };

  const saveKey = async () => {
    if (await run(() => api<Billing>("POST", "/api/apikey", { key }))) { setKey(""); toast.success("API key saved"); }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <Card title="Bill chats to the API">
        <Toggle
          label="Use API key"
          desc={b?.hasKey ? "Chats bill your API balance, not the subscription" : "Add a key below first"}
          on={!!b?.enabled}
          disabled={busy || !b?.hasKey}
          onChange={(v) => run(() => api<Billing>("POST", "/api/apikey/enabled", { enabled: v }))}
        />
      </Card>

      <Card title="API key">
        {b?.hasKey && (
          <Row title={`sk-ant-…${b.last4}`} desc="Stored on this machine, never sent to the browser" mono>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => api<Billing>("DELETE", "/api/apikey"))}>Remove</Button>
          </Row>
        )}
        <div className="flex gap-2 px-2 pt-1">
          <Input
            type="password" autoComplete="off" spellCheck={false} placeholder={b?.hasKey ? "Replace key" : "sk-ant-api…"}
            value={key} onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && key.trim()) saveKey(); }}
          />
          <Button size="md" disabled={busy || !key.trim()} onClick={saveKey}>Save</Button>
        </div>
      </Card>

      <Card title="API spend through Claudex" hint="estimated">
        <Row title="Today" desc={`${b?.today.turns ?? 0} turns`}><span className="text-[14px] tabular-nums">{usd(b?.today.usd ?? 0)}</span></Row>
        <Row title="Last 7 days" desc={`${b?.week.turns ?? 0} turns`}><span className="text-[14px] tabular-nums">{usd(b?.week.usd ?? 0)}</span></Row>
        <Row title="Last 30 days" desc={`${b?.month.turns ?? 0} turns`}><span className="text-[14px] tabular-nums">{usd(b?.month.usd ?? 0)}</span></Row>
      </Card>

      <Note>
        Running chats switch after their current turn. The conversation continues. Set a spend
        limit on the key's workspace in the Anthropic Console. Remaining balance is only
        visible there. Shares bill to whichever mode is on.
      </Note>
    </div>
  );
}
