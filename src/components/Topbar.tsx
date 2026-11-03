import { Menu, Settings, MessageSquare, TerminalSquare, PanelLeft, FolderTree } from "lucide-react";
import { useStore, baseOf, GENERAL_SLUG } from "@/store/store";
import { cn } from "@/lib/utils";
import { GitButton } from "@/components/GitButton";
import { TunnelMenu } from "@/components/TunnelMenu";
import { UsagePill } from "@/components/UsagePill";
import { UpdatePill } from "@/components/UpdatePill";
import { useFilesPanel } from "@/store/panels";

export function Topbar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const active = useStore((s) => s.active);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useStore((s) => s.toggleSidebarCollapsed);
  const projectBySlug = useStore((s) => s.projectBySlug);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const title = active ? projectBySlug(active)?.name ?? "Claudex" : "Claudex";
  const isChat = active ? (mode[active] || "chat") === "chat" : false;
  // The General chat is project-independent (a scratch cwd) - git and tunnel/preview
  // have nothing meaningful to act on, so hide those project-scoped controls for it.
  const filesOpen = useFilesPanel((s) => s.open);
  const toggleFiles = useFilesPanel((s) => s.toggle);
  const hideProjectControls = !!active && baseOf(active) === GENERAL_SLUG;

  return (
    <header
      className="relative z-30 flex items-center px-3 bg-frame shrink-0"
      style={{ height: "calc(52px + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex-1 flex items-center gap-1.5 min-w-0">
        <button onClick={() => setSidebarOpen(true)} className="md:hidden grid place-items-center w-9 h-9 rounded-lg text-fg hover:bg-panel2">
          <Menu size={22} />
        </button>
        <button
          onClick={toggleSidebarCollapsed}
          title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          className="hidden md:grid place-items-center w-9 h-9 rounded-lg text-muted hover:text-fg hover:bg-panel2 transition-colors"
        >
          <PanelLeft size={20} className={cn("transition-transform", sidebarCollapsed && "rotate-180")} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <img src="/icon.svg" alt="" className="w-6 h-6 rounded-sm shrink-0" />
          <b className="text-[15px] font-semibold tracking-[-0.01em] truncate">Claudex</b>
        </div>
      </div>

      {/* project title - desktop only */}
      <div className="hidden md:block shrink-0 max-w-[44%] truncate text-center text-sm font-medium text-muted">{title}</div>

      <div className="flex-1 flex items-center justify-end gap-0.5">
        <UsagePill />
        <UpdatePill />
        {active && !hideProjectControls && (
          <button
            onClick={toggleFiles}
            title={filesOpen ? "Close file explorer" : "Browse project files"}
            // Desktop only: the mobile header already carries the menu, mode toggle, tunnel,
            // git and settings. The explorer is reachable there from a project's ⋮ menu.
            className={cn(
              "hidden md:grid place-items-center w-9 h-9 rounded-lg transition-colors",
              filesOpen ? "text-fg bg-panel2" : "text-muted hover:text-fg hover:bg-panel2",
            )}
          >
            <FolderTree size={19} />
          </button>
        )}
        {active && !hideProjectControls && (
          <button
            onClick={() => setMode(active, isChat ? "terminal" : "chat")}
            title={isChat ? "Switch to terminal" : "Switch to chat"}
            className="grid place-items-center w-9 h-9 rounded-lg text-muted hover:text-fg hover:bg-panel2 transition-colors"
          >
            {isChat ? <TerminalSquare size={20} /> : <MessageSquare size={20} />}
          </button>
        )}
        {!hideProjectControls && <TunnelMenu />}
        {!hideProjectControls && <GitButton />}
        <button onClick={onOpenSettings} className="grid place-items-center w-9 h-9 rounded-lg text-muted hover:text-fg hover:bg-panel2 transition-colors" title="Setup & status">
          <Settings size={20} />
        </button>
      </div>
    </header>
  );
}
