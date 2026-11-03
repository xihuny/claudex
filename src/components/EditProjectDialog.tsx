import { useEffect, useState } from "react";
import { Trash2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { GroupPicker } from "@/components/GroupPicker";
import { ShareDialog } from "@/components/ShareDialog";
import { api } from "@/lib/api";
import { useStore } from "@/store/store";
import { useUI } from "@/store/ui";
import * as terminals from "@/lib/terminals";

export function EditProjectDialog() {
  const p = useUI((s) => s.editProject);
  const close = useUI((s) => s.closeEdit);
  const [name, setName] = useState("");
  const [launch, setLaunch] = useState("");
  const [group, setGroup] = useState("");
  const [busy, setBusy] = useState(false);
  // Rendered as a sibling, not a child: two stacked Radix dialogs fight over focus and
  // the backdrop. Opening the share panel hides this one instead.
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (p) {
      setName(p.name);
      setLaunch(p.launch ?? useStore.getState().defaultLaunch);
      setGroup(p.group ?? "");
    }
  }, [p]);

  if (!p) return null;

  async function save() {
    setBusy(true);
    try {
      await api("PATCH", "/api/projects/" + p!.session, { name, launch, group });
      await useStore.getState().loadProjects();
      close();   // the reloaded name is already on screen - a "Saved" toast only repeats it
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }
  async function del() {
    if (!confirm(`Remove "${p!.name}"?`)) return;
    try {
      await api("DELETE", "/api/projects/" + p!.session);
      terminals.dispose(p!.session);
      useStore.getState().closeTab(p!.session);
      await useStore.getState().loadProjects();
      close();   // tab closed and the row is gone from the sidebar; nothing left to announce
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <>
    <Modal open={!!p && !shareOpen} onClose={close} title="Edit project" subtitle={p.path}>
      <div className="grid gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Launch command" hint="(blank = just a shell)">
          <Input value={launch} onChange={(e) => setLaunch(e.target.value)} placeholder="claude" spellCheck={false} className="font-mono text-[13px]" />
        </Field>
        <GroupPicker value={group} onChange={setGroup} />
        <p className="text-[12px] text-muted">Changes apply next time this project's terminal starts.</p>
      </div>
      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border -mx-5 px-5">
        <Button variant="danger" size="sm" onClick={del}><Trash2 size={15} /> Delete</Button>
        <Button variant="soft" size="sm" onClick={() => setShareOpen(true)}><Share2 size={15} /> Share</Button>
        <div className="flex-1" />
        <Button onClick={save} disabled={busy}>Save</Button>
      </div>
    </Modal>
    {shareOpen && <ShareDialog project={p} open onClose={() => setShareOpen(false)} />}
    </>
  );
}
