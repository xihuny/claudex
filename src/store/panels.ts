// ── Overlay-panel open state ─────────────────────────────────────────────────
//
// This store lives here, apart from the panel it drives, purely for bundling.
// Topbar and the app shell read it to render the launcher button. Declared inside
// FilesView.tsx, importing it would drag the entire component (plus the lazy
// CodeEditor's import graph) into the main chunk - so `lazy()` on the view bought
// nothing. A store module the shell can import without touching the view keeps the
// split real.
import { create } from "zustand";

interface FilesPanelState { open: boolean; setOpen: (v: boolean) => void; toggle: () => void }
export const useFilesPanel = create<FilesPanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
