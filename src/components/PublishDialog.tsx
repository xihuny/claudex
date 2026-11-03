import { useEffect, useState } from "react";
import { Lock, Globe } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PublishDialog({ open, session, defaultName, onClose, onDone }: {
  open: boolean; session: string | null; defaultName: string; onClose: () => void; onDone?: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setName(defaultName); setIsPrivate(true); } }, [open, defaultName]);

  async function publish() {
    if (!session || !name.trim()) return;
    setBusy(true);
    const id = toast.loading("Publishing to GitHub…");
    try {
      const r = await api<{ ok: boolean; url: string }>("POST", "/api/github/publish", { session, name: name.trim(), private: isPrivate });
      toast.success("Published", { id, description: r.url });
      onDone?.(); onClose();
    } catch (e) { toast.error((e as Error).message, { id }); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Publish to GitHub" subtitle="Create a repo and push this project" className="w-[min(420px,calc(100vw-24px))]">
      <div className="grid gap-3">
        <Field label="Repository name">
          <Input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} className="font-mono text-[13px]" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Choice active={isPrivate} onClick={() => setIsPrivate(true)} icon={<Lock size={15} />}>Private</Choice>
          <Choice active={!isPrivate} onClick={() => setIsPrivate(false)} icon={<Globe size={15} />}>Public</Choice>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-border -mx-5 px-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={publish} disabled={busy || !name.trim()}>Publish</Button>
      </div>
    </Modal>
  );
}

function Choice({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn("flex items-center gap-2 h-10 px-3 rounded-lg border text-[14px] font-medium transition-colors",
        active ? "border-fg/40 bg-panel2 text-fg" : "border-transparent bg-panel2 text-muted hover:text-fg")}>
      {icon}{children}
    </button>
  );
}
