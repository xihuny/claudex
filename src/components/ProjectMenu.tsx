import { useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Pencil, Trash2, SquareCode, FolderTree, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/store/store";
import { useUI } from "@/store/ui";
import { api } from "@/lib/api";
import * as terminals from "@/lib/terminals";
import { useFilesPanel } from "@/store/panels";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { Project } from "@/types";
import { cn } from "@/lib/utils";

// DropdownMenu.Item or ContextMenu.Item: both take the same props.
type ItemComp = React.ComponentType<{ onSelect?: (e: Event) => void; className?: string; children?: React.ReactNode }>;

export const menuContentClass = "z-[60] min-w-[180px] rounded-xl border border-border bg-panel2 p-1 shadow-2xl shadow-black/50";

// The project actions, shared by the sidebar's more-options menu and the chip's right-click
// menu. The delete dialog lives outside the menu content, since that unmounts on close.
export function useProjectMenu(p: Project) {
  const openProject = useStore((s) => s.openProject);
  const openEdit = useUI((s) => s.openEdit);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // The explorer browses whatever project is active, so focus this one first. On mobile
  // this is the only way in: the header's file button is desktop-only, since that bar is
  // already stacked there.
  function openFiles() {
    openProject(p.session);
    useFilesPanel.getState().setOpen(true);
  }
  async function openCursor() {
    try { const r = await api<{ ok: boolean; error?: string }>("POST", "/api/open-cursor", { session: p.session }); r.ok ? toast.success("Opening in Cursor…") : toast.error(r.error || "Failed"); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function showInFinder() {
    try { const r = await api<{ ok: boolean; error?: string }>("POST", "/api/show-in-finder", { session: p.session }); if (!r.ok) toast.error(r.error || "Failed"); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function doDelete() {
    setDeleting(true);
    try {
      await api("DELETE", "/api/projects/" + p.session);
      terminals.dispose(p.session);
      useStore.getState().closeTab(p.session);
      await useStore.getState().loadProjects();
      setConfirmOpen(false);   // the row disappearing is the confirmation
    } catch (e) { toast.error((e as Error).message); }
    finally { setDeleting(false); }
  }

  const items = (Item: ItemComp) => (
    <>
      <MenuItem Item={Item} icon={<FolderTree size={16} />} onSelect={openFiles}>Files</MenuItem>
      <MenuItem Item={Item} icon={<SquareCode size={16} />} className="hidden md:flex" onSelect={openCursor}>Open with Cursor</MenuItem>
      <MenuItem Item={Item} icon={<Pencil size={16} />} onSelect={() => openEdit(p)}>Edit</MenuItem>
      <MenuItem Item={Item} icon={<Trash2 size={16} />} danger onSelect={() => setConfirmOpen(true)}>Delete</MenuItem>
    </>
  );

  // The right-click menu is shorter than the more-options menu.
  const contextItems = (Item: ItemComp) => (
    <>
      <MenuItem Item={Item} icon={<Pencil size={16} />} onSelect={() => openEdit(p)}>Edit</MenuItem>
      <MenuItem Item={Item} icon={<FolderOpen size={16} />} className="hidden md:flex" onSelect={showInFinder}>Show in Finder</MenuItem>
    </>
  );

  const dialog = (
    <ConfirmDialog
      open={confirmOpen}
      title={`Remove “${p.name}”?`}
      message="This removes the project from Claudex. The folder on disk is not deleted."
      confirmLabel="Remove"
      danger
      busy={deleting}
      onConfirm={doDelete}
      onClose={() => setConfirmOpen(false)}
    />
  );

  return { items, contextItems, dialog };
}

function MenuItem({ Item, icon, children, onSelect, danger, className }: { Item: ItemComp; icon: React.ReactNode; children: React.ReactNode; onSelect: () => void; danger?: boolean; className?: string }) {
  return (
    <Item onSelect={onSelect}
      className={cn("flex items-center gap-2.5 px-2.5 h-11 md:h-9 rounded-md text-[14px] cursor-pointer outline-none [&_svg]:text-muted",
        danger ? "text-danger [&_svg]:text-danger data-[highlighted]:bg-danger/10" : "text-fg data-[highlighted]:bg-panel", className)}>
      {icon} {children}
    </Item>
  );
}

// Right-click (or long-press on touch) on `children` opens the project menu.
export function ProjectContextMenu({ p, children }: { p: Project; children: React.ReactNode }) {
  const { contextItems, dialog } = useProjectMenu(p);
  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={menuContentClass}>{contextItems(ContextMenu.Item)}</ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {dialog}
    </>
  );
}
