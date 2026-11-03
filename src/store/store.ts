import { create } from "zustand";
import { api } from "@/lib/api";
import { isGuest } from "@/store/me";
import type { Project, SessionMeta } from "@/types";

const ls = {
  get<T>(k: string, d: T): T { try { return JSON.parse(localStorage.getItem(k) || ""); } catch { return d; } },
  set(k: string, v: unknown) { localStorage.setItem(k, JSON.stringify(v)); },
};

// A project can hold several sessions. The project's base slug is session #1; extra
// sessions append "::2", "::3". `openSlugs` and `active` track full *session* slugs;
// the base (project) is recovered by stripping the suffix.
export const baseOf = (slug: string) => slug.split("::")[0];

// Reserved slug for the project-independent "General" chat. Not backed by a real
// project - the server maps it to a synthetic one (a scratch cwd); the client resolves
// it to a display name here. Always chat-only.
export const GENERAL_SLUG = "__general__";
const GENERAL_PROJECT: Project = { name: "General", path: "", session: GENERAL_SLUG };
// Stable identity: returned before the real list loads, so it must not be re-allocated.
const GENERAL_FALLBACK: SessionMeta[] = [{ slug: GENERAL_SLUG, name: "Chat 1" }];

interface State {
  projects: Project[];
  openSlugs: string[];                          // open *session* slugs (one tab per project, but each session keeps a pane)
  active: string | null;                        // active *session* slug
  activeSessionByProject: Record<string, string>; // base slug -> last-active session slug
  attention: string[];                          // base slugs that finished a turn while you were elsewhere
  defaultLaunch: string;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  collapsed: string[];
  mode: Record<string, "terminal" | "chat">;
  ready: boolean;
  // General's conversations. Kept apart from `projects` because General is synthetic -   // folding it into that list would make it render as a project in the sidebar.
  generalSessions: SessionMeta[];
  generalCap: number;

  loadProjects: () => Promise<Project[]>;
  loadGeneral: () => Promise<void>;
  loadConfig: () => Promise<void>;
  setActive: (slug: string | null) => void;
  flagAttention: (base: string) => void;        // mark a project's tab capsule as "finished - check me" (cleared on select)
  openProject: (base: string) => void;          // open/focus a project's last-active session
  openSession: (slug: string) => void;          // open/focus a specific session
  closeSession: (slug: string) => void;         // close one session (keeps the project if siblings remain)
  closeTab: (base: string) => void;             // close a whole project (all its sessions)
  toggleGroup: (g: string) => void;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarWidth: (w: number) => void;
  setMode: (slug: string, m: "terminal" | "chat") => void;
  projectBySlug: (slug: string) => Project | undefined;
  sessionsOf: (base: string) => SessionMeta[];
}

export const useStore = create<State>((set, get) => ({
  projects: [],
  openSlugs: ls.get<string[]>("cx_open", []),
  active: null,
  activeSessionByProject: ls.get<Record<string, string>>("cx_activesess", {}),
  attention: [],   // ephemeral (per page load) - not persisted
  defaultLaunch: "claude",
  generalSessions: [],
  generalCap: 12,
  sidebarOpen: false,
  sidebarCollapsed: ls.get<boolean>("cx_sidebar_collapsed", false),
  sidebarWidth: ls.get<number>("cx_sidebar_w", 264),
  collapsed: ls.get<string[]>("cx_collapsed", []),
  mode: ls.get<Record<string, "terminal" | "chat">>("cx_mode", {}),
  ready: false,

  async loadProjects() {
    const projects = await api<Project[]>("GET", "/api/projects");
    set({ projects, ready: true });
    // Awaited so callers that `await loadProjects()` (create/rename/delete session) see the
    // refreshed General list too, instead of rendering one tick behind.
    await get().loadGeneral();
    return projects;
  },
  async loadGeneral() {
    // General is an owner-only surface. Asking for it as a guest would 401, and a 401 is
    // wired to the "your token died" handler - which would bounce them to the login screen
    // mid-boot for a list they were never going to see.
    if (isGuest()) return;
    try {
      const r = await api<{ sessions: SessionMeta[]; cap: number }>("GET", "/api/general/sessions");
      set({ generalSessions: r.sessions, generalCap: r.cap });
    } catch { /* leave the current list alone */ }
  },
  async loadConfig() {
    try {
      const c = await api<{ defaultLaunch: string }>("GET", "/api/config");
      set({ defaultLaunch: c.defaultLaunch ?? "claude" });
    } catch {}
  },
  setActive(slug) {
    if (!slug) { ls.set("cx_active", null); set({ active: null }); return; }
    const map = { ...get().activeSessionByProject, [baseOf(slug)]: slug };
    ls.set("cx_activesess", map);
    // Persist the *selected* session so refresh resumes exactly here - the last-opened
    // tab (end of openSlugs) isn't the same thing once the user switches tabs/sessions.
    ls.set("cx_active", slug);
    // Selecting a project acknowledges its "finished" highlight. Keep the same array
    // reference when there's nothing to clear so unrelated selects don't churn renders.
    const prevA = get().attention, base = baseOf(slug);
    const attention = prevA.includes(base) ? prevA.filter((b) => b !== base) : prevA;
    set({ active: slug, activeSessionByProject: map, attention });
  },
  flagAttention(base) { if (!get().attention.includes(base)) set({ attention: [...get().attention, base] }); },
  // NB: allocates a fallback array when a project has no explicit session list. Callers
  // must select the *function* and call it in render - never `useStore((s) => s.sessionsOf(x))`,
  // which hands zustand a fresh reference on every notification and re-renders forever.
  sessionsOf(base) {
    if (base === GENERAL_SLUG) {
      const g = get().generalSessions;
      return g.length ? g : GENERAL_FALLBACK;
    }
    const p = get().projects.find((x) => x.session === base);
    return p?.sessions && p.sessions.length ? p.sessions : [{ slug: base, name: "Session 1" }];
  },
  openProject(base) {
    // Resolve to the project's last-active session (falling back to the primary).
    const sessions = get().sessionsOf(base);
    const last = get().activeSessionByProject[base];
    const target = sessions.some((s) => s.slug === last) ? last : base;
    get().openSession(target);
    set({ sidebarOpen: false });
  },
  openSession(slug) {
    const { openSlugs } = get();
    const next = openSlugs.includes(slug) ? openSlugs : [...openSlugs, slug];
    ls.set("cx_open", next);
    set({ openSlugs: next });
    get().setActive(slug);
  },
  closeSession(slug) {
    const { openSlugs, active } = get();
    const next = openSlugs.filter((s) => s !== slug);
    ls.set("cx_open", next);
    let newActive = active;
    if (active === slug) {
      const sibling = [...next].reverse().find((s) => baseOf(s) === baseOf(slug));   // another session of the same project
      newActive = sibling ?? next[next.length - 1] ?? null;
    }
    set({ openSlugs: next });
    get().setActive(newActive);
  },
  closeTab(base) {
    const { openSlugs, active } = get();
    const next = openSlugs.filter((s) => baseOf(s) !== base);
    ls.set("cx_open", next);
    const newActive = active && baseOf(active) === base ? (next[next.length - 1] ?? null) : active;
    set({ openSlugs: next });
    get().setActive(newActive);
  },
  toggleGroup(g) {
    // Group names are case-insensitive, so collapse state has to match that way too.
    const key = g.toLowerCase();
    const collapsed = get().collapsed.some((x) => x.toLowerCase() === key)
      ? get().collapsed.filter((x) => x.toLowerCase() !== key)
      : [...get().collapsed, g];
    ls.set("cx_collapsed", collapsed);
    set({ collapsed });
  },
  setSidebarOpen(v) { set({ sidebarOpen: v }); },
  toggleSidebarCollapsed() { const v = !get().sidebarCollapsed; ls.set("cx_sidebar_collapsed", v); set({ sidebarCollapsed: v }); },
  setSidebarWidth(w) { const width = Math.min(440, Math.max(200, w)); ls.set("cx_sidebar_w", width); set({ sidebarWidth: width }); },
  setMode(slug, m) { const mode = { ...get().mode, [slug]: m }; ls.set("cx_mode", mode); set({ mode }); },
  projectBySlug(slug) {
    if (baseOf(slug) === GENERAL_SLUG) return GENERAL_PROJECT;
    return get().projects.find((p) => p.session === baseOf(slug));
  },
}));
