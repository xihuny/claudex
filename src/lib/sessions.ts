// Shared session actions used by the tab-bar popover and the sidebar. Each keeps the
// server (authoritative session list) and the store (open/active panes) in sync.
import { api } from "@/lib/api";
import { useStore } from "@/store/store";
import { disposeChat } from "@/lib/chat";
import * as terminals from "@/lib/terminals";
import type { SessionMeta } from "@/types";

// Create the next session for a project and open it - in the current view (chat default).
export async function createSession(base: string, view?: "chat" | "terminal"): Promise<SessionMeta> {
  const entry = await api<SessionMeta>("POST", "/api/sessions", { project: base });
  const st = useStore.getState();
  const v = view ?? (st.active ? (st.mode[st.active] || "chat") : "chat");
  st.setMode(entry.slug, v);
  await st.loadProjects();
  st.openSession(entry.slug);
  return entry;
}

export async function renameSession(slug: string, name: string) {
  await api("PATCH", "/api/sessions", { slug, name: name.trim() });
  await useStore.getState().loadProjects();
}

// Close a session everywhere: server process + transcript, client socket/terminal, store.
export async function destroySession(slug: string) {
  await api("DELETE", "/api/sessions", { slug });
  terminals.dispose(slug);
  disposeChat(slug);
  useStore.getState().closeSession(slug);
  await useStore.getState().loadProjects();
}
