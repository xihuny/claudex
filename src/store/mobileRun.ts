// ── Flutter run state shared by the poller and the always-on bottom bar ──────
//
// MobileRunPoller (mounted from TunnelMenu, which already knows the project is
// Flutter) polls /api/mobile/status and publishes it here. MobileRunDock renders
// device/mode/run controls, then reload/restart/stop + logs while the app runs.
import { create } from "zustand";
import { toast } from "sonner";
import { api } from "@/lib/api";

export interface MDevice { id: string; name: string; platform: string; platformType: string; emulator: boolean; emulatorId: string; category: string; connected: boolean; }
export interface MEmulator { id: string; name: string; platformType: string; }
export interface MobileRun {
  running: boolean; exited?: boolean; phase?: string; progress?: string;
  deviceId?: string; deviceName?: string; mode?: string; hasApp?: boolean; logs?: string;
}
export interface MStatus {
  flutter: boolean; available: boolean; daemon?: boolean;
  devices: MDevice[]; emulators: MEmulator[]; run: MobileRun; device?: string; mode?: string;
}
export type Mode = "debug" | "profile" | "release";

// Physical phones first, then booted emulators/simulators, then desktop/web targets;
// unreachable (paired-but-offline wireless) devices sink to the bottom.
const devRank = (d: MDevice) =>
  (d.connected === false ? 3 : (d.platformType === "android" || d.platformType === "ios") ? (d.emulator ? 1 : 0) : 2);
export const sortDevices = (list: MDevice[]) => [...list].sort((a, b) => devRank(a) - devRank(b) || a.name.localeCompare(b.name));

interface MobileRunState {
  slug: string | null;          // project the status below belongs to
  st: MStatus | null;
  sel: string;                  // chosen device id
  mode: Mode;
  booting: Record<string, number>;   // emulator id -> boot start time
  logsOpen: boolean;
  busy: boolean;                // run request in flight
  acting: string;               // "reload" | "restart" | "stop" while in flight
  rescanning: boolean;          // manual device rescan in flight
  rescan: () => Promise<void>;
  setStatus: (slug: string, st: MStatus | null) => void;
  setSel: (id: string) => void;
  setMode: (m: Mode) => void;
  toggleLogs: () => void;
  runApp: () => Promise<void>;
  boot: (em: MEmulator) => Promise<void>;
  act: (path: "reload" | "restart" | "stop", ok?: string) => Promise<void>;
}

export const useMobileRun = create<MobileRunState>((set, get) => ({
  slug: null,
  st: null,
  sel: "",
  mode: "debug",
  booting: {},
  logsOpen: localStorage.getItem("cx_runlogs") !== "0",
  busy: false,
  acting: "",
  rescanning: false,
  // Throws away the server's flutter daemon and rebuilds the device list from a fresh
  // one. The list is meant to stay current by itself; this is the escape hatch for when
  // it doesn't, and the fast path for "I just plugged a phone in".
  rescan: async () => {
    const { slug, rescanning } = get();
    if (!slug || rescanning) return;
    set({ rescanning: true });
    const id = toast.loading("Rescanning devices…");
    try {
      const r = await api<{ devices: MDevice[]; hint?: string }>("POST", "/api/mobile/refresh", { session: slug });
      // Fold the fresh list in straight away - the poller's next tick is up to 5s out.
      const st = get().st;
      if (st && get().slug === slug) get().setStatus(slug, { ...st, devices: r.devices || [] });
      const n = (r.devices || []).filter((d) => d.connected !== false).length;
      // The hint explains a phone that's plugged in yet absent from the list - the one
      // case where "no devices" is about the phone's settings, not about claudex.
      if (r.hint) toast.warning(r.hint, { id, duration: 12000 });
      else toast.success(n ? `${n} device${n > 1 ? "s" : ""} found` : "No devices found", { id });
    } catch (e) { toast.error((e as Error).message, { id }); }
    finally { set({ rescanning: false }); }
  },
  setStatus: (slug, st) => {
    const prev = get();
    if (!st) { set({ slug, st: null }); return; }
    let { sel, mode, booting } = prev;
    if (prev.slug !== slug) {
      // First status for this project: restore its remembered device + mode.
      mode = (["debug", "profile", "release"].includes(st.mode || "") ? st.mode : "debug") as Mode;
      sel = st.device && st.devices.some((d) => d.id === st.device) ? st.device : "";
    }
    // Keep the selection valid as devices come and go; default to the best available.
    if (!sel || !st.devices.some((d) => d.id === sel)) sel = sortDevices(st.devices)[0]?.id || "";
    // Drop "booting" badges once the emulator shows up as a device (or after 2 min).
    const up = new Set(st.devices.map((d) => d.emulatorId).filter(Boolean));
    const next: Record<string, number> = {};
    for (const [id, t] of Object.entries(booting)) if (!up.has(id) && Date.now() - t < 120000) next[id] = t;
    if (Object.keys(next).length !== Object.keys(booting).length) booting = next;
    set({ slug, st, sel, mode, booting });
  },
  setSel: (sel) => set({ sel }),
  setMode: (mode) => set({ mode }),
  toggleLogs: () => set((s) => { localStorage.setItem("cx_runlogs", s.logsOpen ? "0" : "1"); return { logsOpen: !s.logsOpen }; }),
  runApp: async () => {
    const { slug, sel, mode, st, busy } = get();
    if (!slug || !sel || busy) return;
    set({ busy: true });
    const dev = st?.devices.find((d) => d.id === sel);
    const id = toast.loading(`Launching on ${dev?.name || sel}…`);
    try { await api("POST", "/api/mobile/run", { session: slug, deviceId: sel, mode }); toast.success("Build started", { id }); }
    catch (e) { toast.error((e as Error).message, { id }); }
    finally { set({ busy: false }); }
  },
  boot: async (em) => {
    const { slug } = get();
    if (!slug) return;
    set((s) => ({ booting: { ...s.booting, [em.id]: Date.now() } }));
    try { await api("POST", "/api/mobile/emulator", { session: slug, id: em.id }); toast.success(`Booting ${em.name}…`); }
    catch (e) {
      toast.error((e as Error).message);
      set((s) => { const n = { ...s.booting }; delete n[em.id]; return { booting: n }; });
    }
  },
  act: async (path, ok) => {
    const { slug, acting } = get();
    if (!slug || acting) return;
    set({ acting: path });
    try {
      await api("POST", `/api/mobile/${path}`, { session: slug });
      if (ok) toast.success(ok);
      if (path === "stop") set((s) => (s.st ? { st: { ...s.st, run: { running: false } } } : {}));
    } catch (e) { toast.error((e as Error).message); }
    finally { set({ acting: "" }); }
  },
}));
