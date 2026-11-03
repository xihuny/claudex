import { create } from "zustand";

// Who this browser is talking to the server as. Resolved once at boot from /api/me and
// then read all over the UI, so it is a store rather than a prop threaded through the tree.
//
// `role` starts as null and stays null until boot resolves it. Nothing that branches on
// guest-ness renders before then (App holds the shell back until `authed` is known), so
// there is no window where a guest briefly sees owner chrome.
export interface Me {
  role: "owner" | "guest";
  name?: string;          // the guest's display name, as the owner typed it on the share
  session?: string;       // the one session slug a guest is allowed to open
  project?: string;       // base slug of the shared project
  projectName?: string;
  caps?: { git: boolean; bash: boolean };
}

interface MeState {
  me: Me | null;
  setMe: (m: Me | null) => void;
}

export const useMeStore = create<MeState>((set) => ({
  me: null,
  setMe: (me) => set({ me }),
}));

// Convenience selector - `useIsGuest()` reads better at every call site than
// `useMeStore((s) => s.me?.role === "guest")` repeated a dozen times.
export const useIsGuest = () => useMeStore((s) => s.me?.role === "guest");
// Non-reactive read, for the handful of places outside React (event handlers, lib code).
export const isGuest = () => useMeStore.getState().me?.role === "guest";
