import { useEffect, useState, useCallback } from "react";
import { m as motion } from "motion/react";
import { UploadCloud, DownloadCloud, Loader2, Github, GitBranch, Undo2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/api";
import { useStore } from "@/store/store";
import { useIsGuest } from "@/store/me";
import type { GitStatus } from "@/types";
import { cn } from "@/lib/utils";
import { PublishDialog } from "@/components/PublishDialog";

export function GitButton() {
  const active = useStore((s) => s.active);
  const projects = useStore((s) => s.projects);
  // A guest with git enabled gets commit/push/pull and nothing else. Publishing needs the
  // owner's GitHub credentials and creates a repo under their account, so for a share the
  // button simply isn't there rather than being there and failing.
  const guest = useIsGuest();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!active) { setStatus(null); return; }
    try { setStatus(await api<GitStatus>("GET", `/api/git/status?session=${encodeURIComponent(active)}`)); }
    catch { setStatus(null); }
  }, [active]);

  useEffect(() => { refresh(); const t = setInterval(refresh, 12000); return () => clearInterval(t); }, [refresh]);

  // Publishable = no repo yet, or a repo without a remote. Otherwise the git dialog.
  const publishable = !guest && !!status && (!status.repo || !status.remote);
  const pending = !!status?.repo && !!status.remote && !!status.pending;
  // Commits pushed from the other machine, waiting to be pulled. Takes over the icon:
  // pulling before you touch anything is the whole point of surfacing it.
  const incoming = !!status?.repo && !!status.remote && !!status.behind;
  const projectName = projects.find((p) => p.session === (active || "").split("::")[0])?.name || "";
  const title = !status ? "Commit & push"
    : publishable ? "Publish to GitHub"
    : [
        incoming ? `${status.behind} commit${status.behind === 1 ? "" : "s"} to pull` : "",
        status.ahead ? `${status.ahead} unpushed` : "",
        status.dirty ? "uncommitted changes" : "",
      ].filter(Boolean).join(" · ") || "Everything in sync";

  return (
    <>
      <button
        onClick={() => active && (publishable ? setPublishOpen(true) : setGitOpen(true))} disabled={!active} title={title}
        className={cn(
          "relative grid place-items-center w-9 h-9 rounded-lg transition-colors",
          incoming ? "text-warn"                       // pull first - amber owns the whole icon, not just the dot
            : publishable || pending ? "text-accent2"
            : "text-muted hover:text-fg",
        )}
      >
        {publishable ? <Github size={20} /> : incoming ? <DownloadCloud size={20} /> : <UploadCloud size={20} />}
        {(pending || publishable || incoming) && (
          <motion.span
            initial={{ scale: 0 }} animate={{ scale: 1 }}
            className={cn(
              "absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-panel",
              incoming ? "bg-warn" : "bg-accent",   // amber = pull first, green = yours to send
            )}
          />
        )}
      </button>
      <PublishDialog open={publishOpen} session={active} defaultName={projectName} onClose={() => setPublishOpen(false)} onDone={refresh} />
      <GitDialog open={gitOpen} session={active} onClose={() => setGitOpen(false)} onChanged={refresh} />
    </>
  );
}

// Git toasts are for problems only. Progress is already visible as a spinner on the very
// button that started it, and success shows as the dialog closing and the file list going
// quiet - a toast for either just parks over the tab bar carrying no information the screen
// isn't already showing. Errors stay brief; a pull conflict is the one that needs reading.
const ERR_MS = 4000;
const CONFLICT_MS = 7000;

// Per-file status letter tones: modified amber, new green, deleted red, renamed teal.
const FILE_TONE: Record<string, string> = {
  M: "text-warn", A: "text-accent", U: "text-accent", D: "text-danger", R: "text-accent2", C: "text-accent2",
};

// The git dialog: see what changed, commit & push (with an optional message), or
// discard everything back to the last commit. Replaces the old one-tap blind push.
function GitDialog({ open, session, onClose, onChanged }: {
  open: boolean; session: string | null; onClose: () => void; onChanged: () => void;
}) {
  // "Discard all" throws away work that isn't committed anywhere - including the owner's,
  // if they were mid-edit. It stays owner-only (the route refuses a guest regardless).
  const guest = useIsGuest();
  const [st, setSt] = useState<GitStatus | null>(null);
  const [msg, setMsg] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  // fresh=1 forces the server to fetch and wait for it, so the pull count is accurate the
  // moment the dialog opens. The 4s poll rides on the throttled background fetch instead.
  const refresh = useCallback(async (fresh?: boolean) => {
    if (!session) return;
    const q = `session=${encodeURIComponent(session)}&files=1${fresh ? "&fetch=1" : ""}`;
    try { setSt(await api<GitStatus>("GET", `/api/git/status?${q}`)); } catch {}
  }, [session]);

  useEffect(() => {
    if (!open) return;
    setSt(null); setMsg("");
    refresh(true);
    const i = setInterval(refresh, 4000);   // keep the file list live while Claude works
    return () => clearInterval(i);
  }, [open, refresh]);

  async function push() {
    if (!session || pushing) return;
    if (st?.behind) return toast.error("Pull first - the remote has newer commits.", { duration: ERR_MS });   // git would reject it anyway
    setPushing(true);
    try {
      const r = await api<{ ok: boolean; summary: string }>("POST", "/api/git/push", { session, ...(msg.trim() ? { message: msg.trim() } : {}) });
      if (r.ok) onClose();                                    // the dialog closing is the confirmation
      else toast.error(r.summary, { duration: ERR_MS });
    } catch (e) { toast.error("Git error: " + (e as Error).message, { duration: ERR_MS }); }
    finally { setPushing(false); onChanged(); refresh(true); }
  }

  async function pull() {
    if (!session || pulling) return;
    setPulling(true);
    try {
      const r = await api<{ ok: boolean; summary: string }>("POST", "/api/git/pull", { session });
      // Success is silent: the refresh below drops the "behind" count to zero, which says it.
      if (!r.ok) toast.error(r.summary, { duration: CONFLICT_MS });   // conflicts need reading, not a flash
    } catch (e) { toast.error("Git error: " + (e as Error).message, { duration: ERR_MS }); }
    finally { setPulling(false); onChanged(); refresh(true); }
  }

  async function discard() {
    if (!session) return;
    setDiscarding(true);
    try {
      const r = await api<{ ok: boolean; summary: string }>("POST", "/api/git/discard", { session });
      if (r.ok) setConfirmOpen(false);                        // the emptied file list is the confirmation
      else toast.error(r.summary, { duration: ERR_MS });
    } catch (e) { toast.error("Git error: " + (e as Error).message, { duration: ERR_MS }); }
    finally { setDiscarding(false); onChanged(); refresh(); }
  }

  const files = st?.files || [];
  const ahead = st?.ahead || 0;
  const behind = st?.behind || 0;
  const sendable = !!st && (!!st.dirty || ahead > 0);   // anything of ours to commit/push
  const clean = !!st && !sendable && !behind;

  return (
    <>
      <Modal open={open} onClose={onClose} title="Git" subtitle={st?.branch ? `on ${st.branch}` : ""}>
        {!st ? (
          <div className="grid place-items-center py-8 text-muted"><Loader2 size={18} className="animate-spin" /></div>
        ) : clean ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 size={26} className="text-accent" />
            <p className="text-[13.5px] font-medium">In sync</p>
            <p className="text-[12px] text-muted">No local changes, nothing to pull or push.</p>
          </div>
        ) : (
          <div className="grid gap-3.5">
            <div className="flex items-center gap-2 text-[12px]">
              <GitBranch size={13} className="text-muted shrink-0" />
              <span className="font-mono text-fg truncate">{st.branch || "?"}</span>
              {ahead > 0 && (
                <span className="ml-auto shrink-0 px-2 py-0.5 rounded-md bg-accent2/15 text-accent2 font-medium">
                  {ahead} unpushed commit{ahead === 1 ? "" : "s"}
                </span>
              )}
            </div>

            {behind > 0 && (
              <div className="flex items-center gap-2.5 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2.5">
                <DownloadCloud size={16} className="text-warn shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium">{behind} commit{behind === 1 ? "" : "s"} to pull</p>
                  <p className="text-[11px] text-muted leading-snug">
                    {st.busy ? "Claude is working here - pulling can change files under it."
                      : "Pushed from your other machine. Pull before you make changes here."}
                  </p>
                </div>
                <Button size="sm" variant="soft" className="shrink-0" disabled={pulling || pushing} onClick={pull}>
                  {pulling ? <Loader2 size={14} className="animate-spin" /> : <DownloadCloud size={14} />} Pull
                </Button>
              </div>
            )}

            {st.dirty && (
              <>
                <div className="flex flex-col max-h-44 overflow-auto rounded-xl bg-bg border border-border p-1.5">
                  {files.map((f) => {
                    const letter = f.code === "??" ? "U" : f.code[0];
                    const i = f.path.lastIndexOf("/");
                    const dir = i >= 0 ? f.path.slice(0, i) : "";
                    const base = f.path.slice(i + 1);
                    return (
                      <div key={f.path} className="flex items-center gap-2 px-1.5 py-1 min-w-0" title={f.path}>
                        <span className={cn("w-4 shrink-0 text-center font-mono text-[11px] font-semibold", FILE_TONE[letter] || "text-muted")}>{letter}</span>
                        <span className="shrink-0 text-[12px] font-mono">{base}</span>
                        {dir && <span className="flex-1 min-w-0 truncate text-[11px] font-mono text-muted">{dir}</span>}
                      </div>
                    );
                  })}
                </div>
                <Field label="Commit message">
                  <Input
                    value={msg} onChange={(e) => setMsg(e.target.value)} spellCheck={false}
                    placeholder={st.suggested || "Update"} className="font-mono text-[13px]"
                    onKeyDown={(e) => { if (e.key === "Enter") push(); }}
                  />
                </Field>
              </>
            )}
          </div>
        )}

        {st && sendable && (
          <div className="flex gap-2 mt-5 pt-4 border-t border-border -mx-5 px-5">
            {st.dirty && !guest && (
              <Button variant="danger" className="flex-1" disabled={pushing || pulling} onClick={() => setConfirmOpen(true)}>
                <Undo2 size={15} /> Discard all
              </Button>
            )}
            <Button
              className="flex-1" onClick={push} disabled={pushing || pulling || behind > 0}
              title={behind > 0 ? "Pull first - the remote has newer commits" : ""}
            >
              {pushing ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />} {st.dirty ? "Commit & push" : "Push"}
            </Button>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmOpen} danger busy={discarding}
        title="Discard all changes?"
        confirmLabel="Discard"
        message={
          <>
            This resets {files.length} changed file{files.length === 1 ? "" : "s"} to the last commit and deletes new untracked files. It can't be undone.
            {st?.busy && (
              <span className="block mt-2 text-warn">Claude is working in this project right now. Discarding can pull files out from under it.</span>
            )}
          </>
        }
        onConfirm={discard}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}
