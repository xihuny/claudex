import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { m as motion, AnimatePresence } from "motion/react";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCorners, useDroppable,
  type DragStartEvent, type DragOverEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MoreVertical, Plus, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useStore, baseOf } from "@/store/store";
import { useUI } from "@/store/ui";
import { api } from "@/lib/api";
import * as terminals from "@/lib/terminals";
import { Avatar } from "@/components/Avatar";
import { useProjectMenu, menuContentClass } from "@/components/ProjectMenu";
import type { Project } from "@/types";
import { cn } from "@/lib/utils";

const UNGROUPED = "__ungrouped__";
const GROUP_PREFIX = "group:";
const isGroupId = (id: string) => id.startsWith(GROUP_PREFIX);
const groupName = (id: string) => id.slice(GROUP_PREFIX.length);

// Group names are case-insensitive - "work" and "Work" are one bucket, labelled with
// the casing the first project in it uses.
function derive(projects: Project[]) {
  const items: Record<string, string[]> = { [UNGROUPED]: [] };
  const order: string[] = [UNGROUPED];
  const canon = new Map<string, string>();
  for (const p of projects) {
    const raw = p.group || UNGROUPED;
    const key = raw.toLowerCase();
    const k = canon.get(key) ?? raw;
    if (!items[k]) { items[k] = []; order.push(k); canon.set(key, k); }
    items[k].push(p.session);
  }
  return { items, order };
}

// ---- a single draggable project row ----
function Row({ p, overlay }: { p: Project; overlay?: boolean }) {
  const active = useStore((s) => s.active);
  const openSlugs = useStore((s) => s.openSlugs);
  const openProject = useStore((s) => s.openProject);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.session });
  const isActive = !!active && baseOf(active) === p.session;
  const isOpen = openSlugs.some((s) => baseOf(s) === p.session);
  const { items, dialog } = useProjectMenu(p);

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : attributes)} {...(overlay ? {} : listeners)}
      style={overlay ? undefined : { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      className={cn(
        "group flex items-center gap-1 mx-2 pl-2 pr-1 h-11 md:h-9 rounded-md transition-colors select-none",
        isActive ? "bg-panel2" : "hover:bg-panel2/60",
        overlay && "bg-panel2 ring-1 ring-border shadow-2xl shadow-black/60 w-[var(--w,240px)]",
      )}
    >
      <div className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer" onClick={() => openProject(p.session)}>
        <Avatar name={p.name} size={24} />
        <span className={cn("flex-1 min-w-0 truncate text-[14px]", isActive ? "text-fg font-medium" : isOpen ? "text-fg" : "text-fg/75")}>{p.name}</span>
        {/* open in a tab but not focused: a quiet dot, so the list still shows what's open */}
        {isOpen && !isActive && <span className="w-1.5 h-1.5 rounded-full bg-muted/70 shrink-0" />}
      </div>
      {!overlay && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} className="grid place-items-center w-7 h-7 rounded-md text-muted md:opacity-0 md:group-hover:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100 hover:text-fg hover:bg-bg shrink-0 transition-opacity">
              <MoreVertical size={16} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className={menuContentClass}>
              {items(DropdownMenu.Item)}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      {dialog}
    </div>
  );
}

// droppable wrapper so empty / collapsed groups still accept drops
function DropZone({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={cn(className, isOver && "bg-accent/[0.06] rounded-xl")}>{children}</div>;
}

// a draggable, collapsible group that also accepts project drops
function SortableGroup({ name, ids, projectBySlug }: { name: string; ids: string[]; projectBySlug: (s: string) => Project | undefined }) {
  const collapsed = useStore((s) => s.collapsed);
  const toggleGroup = useStore((s) => s.toggleGroup);
  const isCol = collapsed.some((c) => c.toLowerCase() === name.toLowerCase());
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: GROUP_PREFIX + name });
  const { setNodeRef: setDrop, isOver } = useDroppable({ id: name });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "opacity-40")}>
      <div ref={setDrop} className={cn("rounded-xl", isOver && "bg-accent/[0.06]")}>
        <div {...attributes} {...listeners} onClick={() => toggleGroup(name)}
          className="mx-2 flex items-center gap-1.5 pl-2 pr-2.5 pt-5 pb-1.5 cursor-pointer select-none text-[12px] font-medium text-muted hover:text-fg">
          <span className="flex-1 text-left truncate">{name}</span>
          <span className="text-[12px] tabular-nums text-muted shrink-0">{ids.length}</span>
          <ChevronRight size={13} className={cn("shrink-0 transition-transform", !isCol && "rotate-90")} />
        </div>
        <AnimatePresence initial={false}>
          {!isCol && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                {ids.map((sid) => { const p = projectBySlug(sid); return p ? <Row key={sid} p={p} /> : null; })}
                {ids.length === 0 && <div className="mx-2 my-1 h-9 rounded-md border border-dashed border-border/60" />}
              </SortableContext>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ProjectList({ projectBySlug }: { projectBySlug: (s: string) => Project | undefined }) {
  const projects = useStore((s) => s.projects);
  const [items, setItems] = useState<Record<string, string[]>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => { const d = derive(projects); setItems(d.items); setOrder(d.order); }, [projects]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),   // click-and-hold to drag
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),     // touch-and-hold to drag
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findContainer = (id: string) => {
    if (isGroupId(id)) return groupName(id);
    if (id in items) return id;
    return Object.keys(items).find((k) => items[k].includes(id));
  };

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || isGroupId(String(active.id))) return;      // group reordering is resolved on drag end
    const a = findContainer(String(active.id));
    const o = findContainer(String(over.id));
    if (!a || !o || a === o) return;
    setItems((prev) => {
      const aItems = prev[a], oItems = prev[o];
      const overIndex = String(over.id) in prev ? oItems.length : oItems.indexOf(String(over.id));
      const next = [...oItems];
      next.splice(overIndex >= 0 ? overIndex : oItems.length, 0, String(active.id));
      return { ...prev, [a]: aItems.filter((i) => i !== String(active.id)), [o]: next };
    });
  }

  function persist(ord: string[], its: Record<string, string[]>) {
    const payload: { session: string; group: string }[] = [];
    for (const c of ord) for (const sid of its[c] || []) payload.push({ session: sid, group: c === UNGROUPED ? "" : c });
    api("POST", "/api/projects/reorder", { order: payload }).then(() => useStore.getState().loadProjects()).catch((e) => toast.error((e as Error).message));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over) return;
    const aid = String(active.id), oid = String(over.id);
    let nextItems = items, nextOrder = order;

    if (isGroupId(aid)) {
      // reorder groups (group order = order of their blocks in the projects array)
      const ag = groupName(aid);
      const tg = findContainer(oid);
      if (tg && tg !== UNGROUPED && tg !== ag) {
        const gn = order.filter((c) => c !== UNGROUPED);
        const from = gn.indexOf(ag), to = gn.indexOf(tg);
        if (from >= 0 && to >= 0) { nextOrder = [UNGROUPED, ...arrayMove(gn, from, to)]; setOrder(nextOrder); }
      }
    } else {
      const a = findContainer(aid), o = findContainer(oid);
      if (!a || !o) return;
      if (a === o) {
        const arr = items[a];
        const from = arr.indexOf(aid);
        const to = oid in items ? arr.length - 1 : arr.indexOf(oid);
        if (from !== to && to >= 0) { nextItems = { ...items, [a]: arrayMove(arr, from, to) }; setItems(nextItems); }
      }
    }
    persist(nextOrder, nextItems);
  }

  const groupNames = order.filter((c) => c !== UNGROUPED);
  const activeProject = activeId && !isGroupId(activeId) ? projectBySlug(activeId) : null;
  const activeGroup = activeId && isGroupId(activeId) ? groupName(activeId) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className="py-2">
        {/* ungrouped */}
        <DropZone id={UNGROUPED} className="min-h-[8px]">
          <SortableContext items={items[UNGROUPED] || []} strategy={verticalListSortingStrategy}>
            {(items[UNGROUPED] || []).map((sid) => { const p = projectBySlug(sid); return p ? <Row key={sid} p={p} /> : null; })}
          </SortableContext>
        </DropZone>

        {/* groups - themselves reorderable */}
        <SortableContext items={groupNames.map((g) => GROUP_PREFIX + g)} strategy={verticalListSortingStrategy}>
          {groupNames.map((g) => <SortableGroup key={g} name={g} ids={items[g] || []} projectBySlug={projectBySlug} />)}
        </SortableContext>

        {projects.length === 0 && <p className="px-5 py-6 text-[13px] text-muted text-center">No projects yet.</p>}
      </div>
      <DragOverlay>
        {activeGroup ? (
          <div className="mx-2 flex items-center gap-1.5 px-2.5 h-9 rounded-md bg-panel2 ring-1 ring-border shadow-2xl text-[12px] font-medium text-fg">
            <span className="truncate">{activeGroup}</span>
            <span className="ml-auto text-[12px] tabular-nums text-muted">{(items[activeGroup] || []).length}</span>
          </div>
        ) : activeProject ? <Row p={activeProject} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function SidebarBody() {
  const openAdd = useUI((s) => s.openAdd);
  const projectBySlug = useStore((s) => s.projectBySlug);
  return (
    <div className="flex flex-col h-full">
      {/* modern mobile header */}
      <div className="md:hidden flex items-center gap-2.5 px-4 py-3.5" style={{ paddingTop: "calc(0.875rem + env(safe-area-inset-top))" }}>
        <img src="/icon.svg" alt="" className="w-8 h-8 rounded-lg" />
        <div className="leading-tight">
          <div className="font-semibold text-[16px] tracking-[-0.01em]">Claudex</div>
          <div className="text-[12px] text-muted">Projects</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ProjectList projectBySlug={projectBySlug} />
      </div>

      <div className="p-2" style={{ paddingTop: "0.5rem", paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        <button onClick={openAdd}
          className="w-full flex items-center gap-[14px] pl-3 h-11 md:h-9 rounded-md text-[14px] text-muted hover:text-fg hover:bg-panel2/60 active:scale-[0.98] transition-all">
          <Plus size={16} /> Add project
        </button>
      </div>
    </div>
  );
}

export function Sidebar() {
  const width = useStore((s) => s.sidebarWidth);
  const setWidth = useStore((s) => s.setSidebarWidth);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const active = useStore((s) => s.active);
  const dragging = useRef(false);

  useEffect(() => {
    const move = (e: PointerEvent) => { if (dragging.current) { setWidth(e.clientX); if (active) terminals.resize(active); } };
    const up = () => { dragging.current = false; if (active) terminals.resize(active); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [active, setWidth]);

  // Refit the active terminal once the collapse/expand width transition settles.
  useEffect(() => {
    const t = setTimeout(() => { if (active) terminals.resize(active); }, 220);
    return () => clearTimeout(t);
  }, [collapsed, active]);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setSidebarOpen(false); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [sidebarOpen, setSidebarOpen]);

  return (
    <>
      <aside
        className={cn(
          "hidden md:flex relative shrink-0 bg-frame flex-col overflow-hidden transition-[width] duration-200 ease-out",
        )}
        style={{ width: collapsed ? 0 : width }}
      >
        <SidebarBody />
        {!collapsed && (
          <div onPointerDown={(e) => { dragging.current = true; e.preventDefault(); }}
            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-border transition-colors" />
        )}
      </aside>

      {/* Custom mobile drawer - `absolute` inside #app. #app is the ONE box that reaches the
          physical bottom edge (it is in-flow and one bottom-inset taller than the layout
          viewport). `fixed` boxes are clipped to the short viewport on iOS standalone PWAs and
          can never paint the home-indicator strip - so the drawer and overlay anchor to #app
          (relative) with inset-y-0/inset-0, spanning its full height, edge to edge. */}
      <AnimatePresence>
        {sidebarOpen && (
          <div className="md:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setSidebarOpen(false)}
              className="absolute inset-0 z-40 bg-black/55"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Projects"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 40 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0.4, right: 0 }}
              onDragEnd={(_, info) => { if (info.offset.x < -80 || info.velocity.x < -500) setSidebarOpen(false); }}
              className="absolute inset-y-0 left-0 z-50 w-[84vw] max-w-[340px] bg-frame border-r border-border outline-none touch-pan-y"
            >
              <SidebarBody />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
