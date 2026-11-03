import { useEffect, useState } from "react";
import { Copy, Check, Trash2, UserPlus, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

export interface Share {
  id: string;
  token: string;
  name: string;
  project: string;
  allowGit: boolean;
  allowBash: boolean;
  ctxLimit: number;
  createdAt: number;
}

// Every share has its own address. Deliberately NOT a token on the main URL: that would
// overwrite the owner's saved login on any browser that opens it (see api.ts).
const shareUrl = (s: Share) => `${location.origin}/s/${s.token}`;

// A row of the toggles a share is defined by. Both default OFF: the safe configuration is
// the one you get by not thinking about it, and each of these hands the guest something
// that reaches past the project's source code.
function Toggle({ on, onChange, label, hint, warn }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string; warn?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        "flex items-start gap-3 w-full text-left px-3 py-2.5 rounded-lg border transition-colors",
        on ? (warn ? "border-warn/50 bg-warn/5" : "border-fg/30 bg-panel2") : "border-border bg-bg hover:bg-panel2",
      )}
    >
      <span className={cn("mt-0.5 shrink-0 grid place-items-center w-4 h-4 rounded border transition-colors",
        on ? (warn ? "bg-warn border-warn text-bg" : "bg-accent border-accent text-bg") : "border-border")}>
        {on && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-fg">{label}</span>
        <span className="block text-[12px] text-muted leading-snug mt-0.5">{hint}</span>
      </span>
    </button>
  );
}

function ShareRow({ s, onRevoke }: { s: Share; onRevoke: (s: Share) => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl(s));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { toast.error("Couldn't copy - select the link and copy it by hand."); }
  }
  return (
    <div className="rounded-xl bg-bg px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-medium truncate flex-1 min-w-0">{s.name}</span>
        <button onClick={copy} title="Copy invite link"
          className="shrink-0 grid place-items-center w-7 h-7 rounded-md text-muted hover:text-fg hover:bg-panel2 transition-colors">
          {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
        </button>
        <button onClick={() => onRevoke(s)} title="Revoke this share"
          className="shrink-0 grid place-items-center w-7 h-7 rounded-md text-muted hover:text-danger hover:bg-danger/10 transition-colors">
          <Trash2 size={14} />
        </button>
      </div>
      {/* The link IS the password, so it's shown in full rather than masked - there is
          nothing to protect on a screen the owner is already looking at, and a truncated
          link is one the owner can't check against what they pasted. */}
      <div className="mt-1.5 font-mono text-[12px] text-muted break-all leading-snug select-all">{shareUrl(s)}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="px-1.5 py-0.5 rounded-xs text-[11px] font-medium bg-panel2 text-muted">clears at {Math.round(s.ctxLimit / 1000)}K</span>
        {s.allowBash && <span className="px-1.5 py-0.5 rounded-xs text-[11px] font-medium bg-warn/15 text-warn">runs commands</span>}
        {s.allowGit && <span className="px-1.5 py-0.5 rounded-xs text-[11px] font-medium bg-warn/15 text-warn">git</span>}
      </div>
    </div>
  );
}

export function ShareDialog({ project, open, onClose }: { project: Project; open: boolean; onClose: () => void }) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [name, setName] = useState("");
  const [allowGit, setAllowGit] = useState(false);
  const [allowBash, setAllowBash] = useState(false);
  const [ctxLimit, setCtxLimit] = useState(250);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const all = await api<Share[]>("GET", "/api/shares");
      setShares(all.filter((s) => s.project === project.session));
    } catch (e) { toast.error((e as Error).message); setShares([]); }
  }
  useEffect(() => { if (open) load(); }, [open, project.session]);

  async function create() {
    setBusy(true);
    try {
      await api<Share>("POST", "/api/shares", {
        project: project.session,
        name: name.trim() || "Guest",
        allowGit, allowBash,
        ctxLimit: Math.max(20, Math.min(900, ctxLimit)) * 1000,
      });
      setName(""); setAllowGit(false); setAllowBash(false);
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  async function revoke(s: Share) {
    if (!confirm(`Revoke ${s.name}'s access? Their link stops working immediately and their conversation is deleted.`)) return;
    try { await api("DELETE", "/api/shares/" + s.id); await load(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Share this project" subtitle={project.name}>
      <div className="grid gap-4">
        <p className="text-[14px] text-muted leading-relaxed">
          Anyone with the link gets a chat box on <b className="text-fg/80">{project.name}</b> and nothing else -           no terminal, no file browser, no settings, no other project. Claude is told to stay
          on this project's code and to refuse anything else.
        </p>

        {shares === null ? (
          <div className="flex items-center gap-2 text-[13px] text-muted py-2"><Loader2 size={13} className="animate-spin" /> Loading shares…</div>
        ) : shares.length > 0 ? (
          <div className="grid gap-2">
            {shares.map((s) => <ShareRow key={s.id} s={s} onRevoke={revoke} />)}
          </div>
        ) : null}

        <div className="grid gap-3 pt-1 border-t border-border">
          <Field label="Who is this for?" hint="(shown to them, and on the tab you watch)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sara" />
          </Field>

          <Field label="Clear their conversation at" hint="(thousands of tokens)" plain>
            <div className="flex items-center gap-2">
              <Input type="number" min={20} max={900} step={10} value={ctxLimit}
                onChange={(e) => setCtxLimit(Number(e.target.value))} className="w-28 font-mono text-[13px]" />
              <span className="text-[12px] text-muted">K - then it starts fresh on its own</span>
            </div>
          </Field>

          <Field label="Extra permissions" hint="(both off by default)" plain>
            <div className="grid gap-2">
              <Toggle
                on={allowBash} onChange={setAllowBash} warn
                label="Let them run commands"
                hint="Needed for tests and builds. A shell runs as your user account: it lifts the wall around the project directory, and a determined guest can read or change anything your account can. Only for people you would hand the machine to."
              />
              <Toggle
                on={allowGit} onChange={setAllowGit} warn
                label="Allow git"
                hint="Adds a commit & push button to their view, using your credentials. It commits everything in the project, including your own uncommitted changes, and can only push this project - never discard changes, never publish a new repo. Off means no git at all."
              />
            </div>
          </Field>

          {allowBash && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-warn/10 border border-warn/30 text-[13px] text-fg/85 leading-snug">
              <ShieldAlert size={14} className="text-warn shrink-0 mt-0.5" />
              <span>With commands on, the directory limit is advisory rather than enforced: the shell has the same access as your own account (your password is kept out of it). Everything else about the share still holds.</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center mt-4 pt-4 border-t border-border -mx-5 px-5">
        <div className="flex-1" />
        <Button onClick={create} disabled={busy}>
          <UserPlus size={15} /> {busy ? "Creating…" : "Create link"}
        </Button>
      </div>
    </Modal>
  );
}
