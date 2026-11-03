import { create } from "zustand";
import type { Project } from "@/types";

interface UI {
  addOpen: boolean;
  editProject: Project | null;
  setupOpen: boolean;
  paletteOpen: boolean;
  openAdd: () => void;
  closeAdd: () => void;
  openEdit: (p: Project) => void;
  closeEdit: () => void;
  openSetup: () => void;
  closeSetup: () => void;
  setPalette: (v: boolean) => void;
}

export const useUI = create<UI>((set) => ({
  addOpen: false,
  editProject: null,
  setupOpen: false,
  paletteOpen: false,
  openAdd: () => set({ addOpen: true }),
  closeAdd: () => set({ addOpen: false }),
  openEdit: (p) => set({ editProject: p }),
  closeEdit: () => set({ editProject: null }),
  openSetup: () => set({ setupOpen: true }),
  closeSetup: () => set({ setupOpen: false }),
  setPalette: (v) => set({ paletteOpen: v }),
}));
