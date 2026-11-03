// ── Appearance ───────────────────────────────────────────────────────────────
//
// Seven palettes × light/dark. All of it resolves to two attributes on <html> - // `data-theme` and `data-scheme` - which index.css keys its custom-property blocks
// off. Nothing else in the app reads this store: components already use semantic
// Tailwind tokens (bg-panel, text-muted, text-warn, …) and those compile to
// var(--color-*) references, so swapping the variables re-themes everything.
//
// Device-local (localStorage), not server config: the phone and the laptop should be
// able to disagree about light mode.
import { create } from "zustand";

export type ThemeId =
  | "claudex" | "catppuccin" | "rosepine" | "nord" | "everforest" | "tokyonight" | "solarized";
export type SchemePref = "dark" | "light" | "system";

// Order here is the order in the picker. Keep the ids in step with index.css.
export const THEMES: { id: ThemeId; label: string; blurb: string }[] = [
  { id: "claudex", label: "Claudex", blurb: "The original near-black and neon green" },
  { id: "catppuccin", label: "Catppuccin", blurb: "Soft pastels, the popular comfort palette" },
  { id: "rosepine", label: "Rosé Pine", blurb: "Muted rose and pine, low contrast" },
  { id: "nord", label: "Nord", blurb: "Cool arctic blue-grey, bright-room friendly" },
  { id: "everforest", label: "Everforest", blurb: "Warm greens built to reduce eye strain" },
  { id: "tokyonight", label: "Tokyo Night", blurb: "Deep indigo with a blue accent" },
  { id: "solarized", label: "Solarized", blurb: "The original eye-comfort palette" },
];

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id));

const K_THEME = "cx_theme";
const K_SCHEME = "cx_scheme";

const isTheme = (v: string | null): v is ThemeId => v !== null && THEME_IDS.has(v);
const isScheme = (v: string | null): v is SchemePref => v === "dark" || v === "light" || v === "system";

const mqDark = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Resolve the "system" scheme against the OS. */
export function resolveScheme(pref: SchemePref): "dark" | "light" {
  if (pref !== "system") return pref;
  return mqDark().matches ? "dark" : "light";
}

// The browser UI (iOS status bar, Android nav bar) tracks <meta name="theme-color">, so
// it has to follow the palette or a light theme keeps a black notch strip.
function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim();
  if (!bg) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = bg;
}

function apply(theme: ThemeId, scheme: SchemePref) {
  const el = document.documentElement;
  const resolved = resolveScheme(scheme);
  el.dataset.theme = theme;
  el.dataset.scheme = resolved;
  // colorScheme drives the native form controls, scrollbars and caret; without it a
  // light theme still renders dark <select> popups and a dark-on-dark text cursor.
  el.style.colorScheme = resolved;
  syncThemeColor();
  // xterm paints to a canvas and can't inherit CSS variables - terminals.ts listens
  // for this and re-applies the palette to every live terminal.
  window.dispatchEvent(new CustomEvent("cx-theme-change"));
}

interface ThemeState {
  theme: ThemeId;
  scheme: SchemePref;
  /** Recomputed on OS changes so the UI can show what "System" currently resolves to. */
  resolvedScheme: "dark" | "light";
  setTheme: (t: ThemeId) => void;
  setScheme: (s: SchemePref) => void;
}

const stored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const initTheme: ThemeId = isTheme(stored(K_THEME)) ? (stored(K_THEME) as ThemeId) : "claudex";
const initScheme: SchemePref = isScheme(stored(K_SCHEME)) ? (stored(K_SCHEME) as SchemePref) : "dark";

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initTheme,
  scheme: initScheme,
  resolvedScheme: resolveScheme(initScheme),
  setTheme: (theme) => {
    try { localStorage.setItem(K_THEME, theme); } catch {}
    set({ theme });
    apply(theme, get().scheme);
  },
  setScheme: (scheme) => {
    try { localStorage.setItem(K_SCHEME, scheme); } catch {}
    set({ scheme, resolvedScheme: resolveScheme(scheme) });
    apply(get().theme, scheme);
  },
}));

/** Follow the OS while the scheme pref is on "system". */
export function watchSystemScheme() {
  const onChange = () => {
    const st = useTheme.getState();
    if (st.scheme !== "system") return;
    useTheme.setState({ resolvedScheme: resolveScheme("system") });
    apply(st.theme, st.scheme);
  };
  mqDark().addEventListener("change", onChange);
  return () => mqDark().removeEventListener("change", onChange);
}

// Apply once at module load. The inline script in index.html has normally done this
// already (before first paint); this re-runs it so the two can't disagree, and covers
// the case where that script was skipped.
apply(initTheme, initScheme);
