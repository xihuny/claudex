// ── Project file explorer - an on-demand overlay ─────────────────────────────
//
// An overlay panel: mounts as a sibling of ChatView/TerminalView and
// PAINTS OVER them when open (they're absolute inset-0 at z 0/1; this is z-10), so
// neither needed a line changed. It owns its open-state
// store; the only session coupling is *reading* the active project from useStore to
// know which root to browse - switching projects re-roots the explorer in place.
//
// Server counterpart: the /api/fs/* routes, which confine every path inside the
// project directory. The default workflow stays chat/terminal - this exists for the
// "let me just look at the tree / tweak one file / add a file by hand" moments.

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  X, Folder, FileText, FileCode2, FileImage, FileArchive, Loader2, ChevronRight,
  ChevronLeft, FilePlus2, FolderPlus, Eye, EyeOff, RotateCw, MoreVertical, Pencil,
  Trash2, Download, FileQuestion, Save,
} from "lucide-react";
import { toast } from "sonner";
import { api, fsFileUrl } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useStore, baseOf, GENERAL_SLUG } from "@/store/store";
import { useFilesPanel } from "@/store/panels";
import { cn } from "@/lib/utils";

const CodeEditor = lazy(() => import("@/components/CodeEditor"));

interface Entry { name: string; dir: boolean; size: number; mtime: number }
interface Listing { root: string; rel: string; entries: Entry[]; truncated: boolean }
interface OpenFile {
  rel: string; name: string;
  kind: "text" | "image" | "binary";
  content: string; orig: string;          // editor value vs last-saved value (dirty = differ)
  size: number; truncated: boolean;
}

const HIDDEN_KEY = "cx_files_hidden";
const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/i;
const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|py|rb|go|rs|swift|kt|java|c|h|cpp|hpp|sh|zsh|yml|yaml|toml|sql|vue|svelte)$/i;
const ARCHIVE_RE = /\.(zip|gz|tar|tgz|bz2|xz|7z|rar|jar)$/i;

const join = (a: string, b: string) => (a ? `${a}/${b}` : b);
const dirOf = (rel: string) => rel.split("/").slice(0, -1).join("/");

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
// Short "when": time for today, day+month otherwise - the list column is narrow.
function fmtTime(ms: number) {
  if (!ms) return "";
  const d = new Date(ms);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function fileIcon(e: Entry) {
  if (e.dir) return <Folder size={16} className="text-fg/70" />;
  if (IMG_RE.test(e.name)) return <FileImage size={16} className="text-muted" />;
  if (CODE_RE.test(e.name)) return <FileCode2 size={16} className="text-muted" />;
  if (ARCHIVE_RE.test(e.name)) return <FileArchive size={16} className="text-muted" />;
  return <FileText size={16} className="text-muted" />;
}

// Raw-bytes URL for previews/downloads - cookie-gated, same contract as /uploads.
const rawUrl = fsFileUrl;

export function FilesView() {
  const open = useFilesPanel((s) => s.open);
  const setOpen = useFilesPanel((s) => s.setOpen);
  const active = useStore((s) => s.active);
  const projectBySlug = useStore((s) => s.projectBySlug);
  const base = active ? baseOf(active) : null;
  const project = active ? projectBySlug(active) : undefined;
  const hasRoot = !!project?.path && base !== GENERAL_SLUG;

  const [rel, setRel] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(localStorage.getItem(HIDDEN_KEY) === "1");
  const [file, setFile] = useState<OpenFile | null>(null);
  const [opening, setOpening] = useState<string | null>(null);   // rel of the file being fetched
  const [saving, setSaving] = useState(false);
  // Dialogs. `name` doubles as the new-file/new-folder/rename prompt; which one it is
  // lives in `mode` (rename carries the entry it renames).
  const [nameDlg, setNameDlg] = useState<{ mode: "file" | "folder" | "rename"; target?: Entry; value: string } | null>(null);
  const [toDelete, setToDelete] = useState<Entry | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);

  const dirty = !!file && file.kind === "text" && file.content !== file.orig;

  const load = useCallback(async (dir: string) => {
    if (!active) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ session: active, path: dir });
      setListing(await api<Listing>("GET", `/api/fs/list?${q}`));
    } catch (e) {
      toast.error((e as Error).message);
      // A directory that vanished under us (deleted in a chat turn) → fall back to root.
      if (dir) { setRel(""); return; }
    } finally { setLoading(false); }
  }, [active]);

  // Re-root when the project changes; refresh when the dir or panel-open state changes.
  const lastBase = useRef(base);
  useEffect(() => {
    if (base !== lastBase.current) {
      lastBase.current = base;
      setRel(""); setFile(null); setListing(null);
      if (open && hasRoot) load("");
      return;
    }
    if (open && hasRoot) load(rel);
  }, [open, base, rel, hasRoot, load]);

  // Esc walks back out: editor → listing → closed. Dialogs handle their own Esc and
  // these flags make us stand down so one keypress never closes two layers.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || nameDlg || toDelete || confirmDiscard) return;
      if (file) requestCloseFile();
      else setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function requestCloseFile() {
    if (dirty) setConfirmDiscard(true);
    else setFile(null);
  }

  async function openEntry(e: Entry) {
    const target = join(rel, e.name);
    if (e.dir) { setRel(target); return; }
    if (IMG_RE.test(e.name)) {
      setFile({ rel: target, name: e.name, kind: "image", content: "", orig: "", size: e.size, truncated: false });
      return;
    }
    setOpening(target);
    try {
      const q = new URLSearchParams({ session: active!, path: target });
      const r = await api<{ size: number; truncated: boolean; binary: boolean; content: string | null }>("GET", `/api/fs/read?${q}`);
      setFile(r.binary
        ? { rel: target, name: e.name, kind: "binary", content: "", orig: "", size: r.size, truncated: false }
        : { rel: target, name: e.name, kind: "text", content: r.content ?? "", orig: r.content ?? "", size: r.size, truncated: r.truncated });
    } catch (err) { toast.error((err as Error).message); }
    finally { setOpening(null); }
  }

  async function save() {
    if (!file || !dirty || file.truncated) return;
    setSaving(true);
    try {
      await api("POST", "/api/fs/write", { session: active, path: file.rel, content: file.content });
      setFile({ ...file, orig: file.content });
      toast.success("Saved " + file.name);
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  async function submitName() {
    if (!nameDlg) return;
    const value = nameDlg.value.trim().replace(/^[/\\]+|[/\\]+$/g, "");
    if (!value) return;
    setBusy(true);
    try {
      if (nameDlg.mode === "rename" && nameDlg.target) {
        await api("POST", "/api/fs/rename", { session: active, path: join(rel, nameDlg.target.name), to: join(rel, value) });
      } else if (nameDlg.mode === "folder") {
        await api("POST", "/api/fs/mkdir", { session: active, path: join(rel, value) });
      } else {
        await api("POST", "/api/fs/write", { session: active, path: join(rel, value), content: "", create: 1 });
      }
      const created = nameDlg.mode === "file" ? join(rel, value) : null;
      setNameDlg(null);
      await load(rel);
      // A just-created file opens straight into the editor - that's why you made it.
      if (created) {
        const name = created.split("/").pop()!;
        setFile({ rel: created, name, kind: "text", content: "", orig: "", size: 0, truncated: false });
      }
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  async function doDelete() {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api("POST", "/api/fs/delete", { session: active, path: join(rel, toDelete.name) });
      setToDelete(null);
      await load(rel);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!open) return null;

  const crumbs = rel ? rel.split("/") : [];
  const entries = (listing?.entries ?? []).filter((e) => showHidden || !e.name.startsWith("."));

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-bg">
      {!hasRoot ? (
        // Active pane is General (or nothing) - there's no directory to browse.
        <div className="flex-1 grid place-items-center text-fg text-[14px] px-6 text-center">
          <div>
            <Folder size={28} strokeWidth={1.5} className="mx-auto mb-3 text-muted" />
            The General chat has no project directory.
            <div className="mt-1 text-[12px] text-muted">Switch to a project to browse its files.</div>
          </div>
        </div>
      ) : file ? (
        <FileViewer
          key={file.rel}
          session={active!}
          file={file}
          dirty={dirty}
          saving={saving}
          onChange={(content) => setFile((f) => (f ? { ...f, content } : f))}
          onSave={save}
          onBack={requestCloseFile}
        />
      ) : (
        <>
          {/* toolbar: back + breadcrumbs left (scrollable), actions right. The bar spans the
              pane; its contents sit in the same max-w-3xl column as the chat, so a wide
              window doesn't fling the actions to the far edge. */}
          <div className="border-b border-border shrink-0">
           <div className="max-w-3xl mx-auto w-full flex items-center gap-1 px-2.5 h-12">
            {/* Always present, disabled at the root: as a row in the list it appeared and
                disappeared with depth, shifting every entry down a line on each step in. */}
            <IconBtn title="Up one level" disabled={!rel} onClick={() => setRel(dirOf(rel))}>
              <ChevronLeft size={19} />
            </IconBtn>
            <div className="flex-1 flex items-center gap-0.5 min-w-0 overflow-x-auto no-scrollbar text-[14px]">
              <button
                onClick={() => setRel("")}
                className={cn("shrink-0 px-2 py-1 rounded-md transition-colors", rel ? "text-muted hover:text-fg hover:bg-panel2" : "text-fg font-medium")}
              >
                {listing?.root || project?.name}
              </button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-0.5 shrink-0">
                  <ChevronRight size={13} className="text-muted shrink-0" />
                  <button
                    onClick={() => setRel(crumbs.slice(0, i + 1).join("/"))}
                    className={cn("px-2 py-1 rounded-md transition-colors max-w-[160px] truncate",
                      i === crumbs.length - 1 ? "text-fg font-medium" : "text-muted hover:text-fg hover:bg-panel2")}
                  >
                    {c}
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <IconBtn title="New file" onClick={() => setNameDlg({ mode: "file", value: "" })}><FilePlus2 size={17} /></IconBtn>
              <IconBtn title="New folder" onClick={() => setNameDlg({ mode: "folder", value: "" })}><FolderPlus size={17} /></IconBtn>
              <IconBtn
                title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
                onClick={() => { const v = !showHidden; localStorage.setItem(HIDDEN_KEY, v ? "1" : "0"); setShowHidden(v); }}
              >
                {showHidden ? <Eye size={17} /> : <EyeOff size={17} />}
              </IconBtn>
              <IconBtn title="Refresh" onClick={() => load(rel)}><RotateCw size={16} className={cn(loading && "animate-spin")} /></IconBtn>
              <IconBtn title="Close explorer" onClick={() => setOpen(false)}><X size={18} /></IconBtn>
            </div>
           </div>
          </div>

          {/* listing */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {listing?.truncated && (
              <div className="max-w-3xl mx-auto w-full px-1.5">
                <div className="mx-1.5 mt-2 px-3 py-2 rounded-md bg-panel text-[12px] text-muted">
                  Large directory. Showing the first <span className="tabular-nums">{listing.entries.length}</span> entries.
                </div>
              </div>
            )}
            <div className="max-w-3xl mx-auto w-full px-1.5 py-1.5 pb-[max(12px,env(safe-area-inset-bottom))]">
              {!loading && listing && entries.length === 0 && (
                <div className="py-14 text-center text-muted text-[14px]">
                  <FileQuestion size={24} strokeWidth={1.5} className="mx-auto mb-2" />
                  Empty folder
                </div>
              )}
              {/* No enter/exit animation: navigating a tree is a replacement, not a
                  transition. Per-row `layout` animation made every entry that existed in
                  both directories glide from its old slot to its new one while the outgoing
                  rows were still fading out of the flow - the whole list appeared to scroll
                  up on each step in. A directory should just be there. */}
              {entries.map((e) => {
                const target = join(rel, e.name);
                return (
                  <div
                    key={e.name}
                    className="group flex items-center gap-3 pl-2.5 pr-1 h-11 md:h-9 rounded-md hover:bg-panel2/60 transition-colors cursor-pointer"
                    onClick={() => openEntry(e)}
                  >
                    <span className="shrink-0">{fileIcon(e)}</span>
                    <span className={cn("flex-1 min-w-0 truncate text-[14px]", e.name.startsWith(".") ? "text-muted" : "text-fg")}>
                      {e.name}
                    </span>
                    {opening === target
                      ? <Loader2 size={14} className="shrink-0 animate-spin text-muted" />
                      : <span className="shrink-0 text-right text-[12px] text-muted tabular-nums">
                          {e.dir ? "" : fmtSize(e.size)}
                          <span className="hidden sm:inline">{e.dir ? fmtTime(e.mtime) : ` · ${fmtTime(e.mtime)}`}</span>
                        </span>}
                    <EntryMenu
                      entry={e}
                      onRename={() => setNameDlg({ mode: "rename", target: e, value: e.name })}
                      onDelete={() => setToDelete(e)}
                      downloadUrl={e.dir ? null : rawUrl(active!, target, true)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* name prompt - new file / new folder / rename */}
      <Modal
        open={!!nameDlg}
        onClose={() => setNameDlg(null)}
        title={nameDlg?.mode === "rename" ? "Rename" : nameDlg?.mode === "folder" ? "New folder" : "New file"}
        subtitle={nameDlg?.mode === "rename" ? nameDlg.target?.name : rel ? `in ${rel}` : undefined}
      >
        <form onSubmit={(e) => { e.preventDefault(); submitName(); }} className="flex flex-col gap-4 pb-3">
          <Input
            autoFocus
            value={nameDlg?.value ?? ""}
            onChange={(e) => setNameDlg((d) => (d ? { ...d, value: e.target.value } : d))}
            placeholder={nameDlg?.mode === "folder" ? "folder-name" : "notes.md or docs/notes.md"}
            autoCapitalize="off" autoCorrect="off" spellCheck={false}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setNameDlg(null)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !nameDlg?.value.trim()}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : nameDlg?.mode === "rename" ? "Rename" : "Create"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title={`Delete ${toDelete?.dir ? "folder" : "file"}?`}
        message={<>“{toDelete?.name}”{toDelete?.dir && " and everything inside it"} will be permanently deleted.</>}
        confirmLabel="Delete"
        danger busy={busy}
        onConfirm={doDelete}
        onClose={() => setToDelete(null)}
      />

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard changes?"
        message={<>“{file?.name}” has unsaved edits.</>}
        confirmLabel="Discard"
        danger
        onConfirm={() => { setConfirmDiscard(false); setFile(null); }}
        onClose={() => setConfirmDiscard(false)}
      />
    </div>
  );
}

function IconBtn({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "grid place-items-center w-9 h-9 rounded-md transition-colors",
        disabled ? "text-muted/40 cursor-default" : "text-muted hover:text-fg hover:bg-panel2",
      )}
    >
      {children}
    </button>
  );
}

function EntryMenu({ entry, onRename, onDelete, downloadUrl }: {
  entry: Entry; onRename: () => void; onDelete: () => void; downloadUrl: string | null;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="grid place-items-center w-8 h-8 rounded-md text-muted md:opacity-0 md:group-hover:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100 hover:text-fg hover:bg-panel2 shrink-0 transition-opacity"
          title="Actions"
        >
          <MoreVertical size={15} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end" sideOffset={4}
          className="z-[70] min-w-[150px] rounded-xl border border-border bg-panel2 shadow-2xl shadow-black/50 p-1 text-[14px]"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu.Item onSelect={onRename} className="flex items-center gap-2 px-2.5 py-2 rounded-md outline-none cursor-pointer text-fg data-[highlighted]:bg-panel">
            <Pencil size={14} className="text-muted" /> Rename
          </DropdownMenu.Item>
          {downloadUrl && (
            <DropdownMenu.Item asChild>
              <a href={downloadUrl} download={entry.name} className="flex items-center gap-2 px-2.5 py-2 rounded-md outline-none cursor-pointer text-fg data-[highlighted]:bg-panel">
                <Download size={14} className="text-muted" /> Download
              </a>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item onSelect={onDelete} className="flex items-center gap-2 px-2.5 py-2 rounded-md outline-none cursor-pointer text-danger data-[highlighted]:bg-danger/10">
            <Trash2 size={14} /> Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function FileViewer({ session, file, dirty, saving, onChange, onSave, onBack }: {
  session: string; file: OpenFile; dirty: boolean; saving: boolean;
  onChange: (v: string) => void; onSave: () => void; onBack: () => void;
}) {
  // Cmd/Ctrl+S saves instead of triggering the browser's save-page dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); onSave(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave]);

  return (
    <>
      {/* Same column as the listing and the chat - full-bleed code on a wide monitor is a
          wall of text with the save button a screen away from the filename. */}
      <div className="border-b border-border shrink-0">
       <div className="max-w-3xl mx-auto w-full flex items-center gap-1 px-2 h-12">
        <IconBtn title="Back" onClick={onBack}><ChevronLeft size={19} /></IconBtn>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="truncate text-[14px] text-fg font-medium">{file.name}</span>
          {dirty && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" title="Unsaved changes" />}
          <span className="hidden sm:inline text-[12px] text-muted tabular-nums shrink-0">{fmtSize(file.size)}</span>
        </div>
        {file.kind !== "text" || file.truncated ? (
          <a
            href={rawUrl(session, file.rel, true)} download={file.name}
            className="grid place-items-center w-9 h-9 rounded-md text-muted hover:text-fg hover:bg-panel2 transition-colors" title="Download"
          >
            <Download size={17} />
          </a>
        ) : (
          <button
            onClick={onSave}
            disabled={!dirty || saving}
            className={cn(
              "flex items-center gap-1.5 h-8 px-3 mr-1 rounded-md text-[13px] font-medium active:scale-[0.97] transition-all",
              dirty ? "bg-accent text-bg hover:bg-accent2" : "text-muted bg-panel2",
            )}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        )}
       </div>
      </div>

      {file.kind === "image" ? (
        <div className="flex-1 min-h-0 grid place-items-center p-4 overflow-auto">
          <img
            src={rawUrl(session, file.rel)}
            alt={file.name}
            className="max-w-full max-h-full rounded-md border border-border"
          />
        </div>
      ) : file.kind === "binary" ? (
        <div className="flex-1 grid place-items-center text-center text-fg text-[14px] px-6">
          <div>
            <FileArchive size={28} strokeWidth={1.5} className="mx-auto mb-3 text-muted" />
            Binary file · <span className="tabular-nums">{fmtSize(file.size)}</span>
            <div className="mt-1 text-[12px] text-muted">Use Download to save it to your device.</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden max-w-3xl mx-auto w-full">
          {file.truncated && (
            <div className="mx-3 mt-2 px-3 py-2 rounded-md bg-panel text-[12px] text-muted">
              File is over 1 MB. Showing the first part, read-only.
            </div>
          )}
          <Suspense fallback={<div className="h-full grid place-items-center text-muted"><Loader2 size={20} className="animate-spin" /></div>}>
            <CodeEditor filename={file.name} value={file.content} readOnly={file.truncated} onChange={onChange} />
          </Suspense>
        </div>
      )}
    </>
  );
}
