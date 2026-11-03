// ── Appearance settings ──────────────────────────────────────────────────────
//
// Theme and light/dark. Both write to the theme store, which sets data-theme and
// data-scheme on <html>; index.css does the rest.
//
// The previews are built from the same custom properties as the real UI - the card
// wrapper carries its own data-theme/data-scheme, which re-scopes the palette
// variables for that subtree exactly as they do on <html>. So each card is the actual
// theme at small scale and can't drift from what tapping it produces.
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Card } from "@/components/settings/parts";
import { THEMES, useTheme, type SchemePref, type ThemeId } from "@/store/theme";
import { cn } from "@/lib/utils";

// A miniature of the app shell: sidebar rail, a message bubble, two lines of text,
// the composer and its accent send button. Enough surfaces that a palette's contrast
// and warmth are both visible at a glance.
function ThemePreview({ theme, scheme }: { theme: ThemeId; scheme: "dark" | "light" }) {
  return (
    <div
      data-theme={theme}
      data-scheme={scheme}
      className="h-[52px] rounded-lg overflow-hidden border border-border bg-bg flex pointer-events-none select-none"
    >
      <div className="w-6 shrink-0 bg-panel border-r border-border flex flex-col gap-[3px] p-1">
        <div className="h-1 rounded-full bg-accent" />
        <div className="h-1 rounded-full bg-muted/40" />
        <div className="h-1 rounded-full bg-muted/40" />
      </div>
      <div className="flex-1 min-w-0 p-1 flex flex-col gap-[3px]">
        <div className="self-end h-2.5 w-1/2 rounded bg-panel2 border border-border" />
        <div className="h-1 w-full rounded-full bg-muted/45" />
        <div className="h-1 w-3/4 rounded-full bg-muted/30" />
        <div className="mt-auto flex items-center gap-1">
          <div className="flex-1 h-2.5 rounded bg-panel border border-border" />
          <div className="w-2.5 h-2.5 rounded bg-accent" />
        </div>
      </div>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; icon: typeof Sun }[];
}) {
  return (
    <div className="flex gap-1 p-1 rounded-lg bg-bg">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            aria-pressed={on}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-[13px] transition-colors",
              on ? "bg-panel2 text-fg font-medium" : "text-muted hover:text-fg hover:bg-panel2/60",
            )}
          >
            <o.icon size={13} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function AppearancePane() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const scheme = useTheme((s) => s.scheme);
  const setScheme = useTheme((s) => s.setScheme);
  const resolvedScheme = useTheme((s) => s.resolvedScheme);

  return (
    <div className="flex flex-col gap-2.5">
      <Card
        title="Light or dark"
        hint={scheme === "system" ? `Following your device - currently ${resolvedScheme}.` : undefined}
      >
        <Segmented<SchemePref>
          value={scheme}
          onChange={setScheme}
          options={[
            { id: "light", label: "Light", icon: Sun },
            { id: "dark", label: "Dark", icon: Moon },
            { id: "system", label: "System", icon: Monitor },
          ]}
        />
      </Card>

      <Card
        title="Theme"
        hint="Every theme has a light and a dark variant. Applies instantly, remembered on this device only."
      >
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((t) => {
            const on = t.id === theme;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                aria-pressed={on}
                title={t.blurb}
                className={cn(
                  "text-left p-1.5 rounded-lg border transition-colors min-w-0",
                  on ? "border-fg/60 bg-panel2" : "border-transparent bg-panel2/60 hover:bg-panel2",
                )}
              >
                {/* Previewed in whichever scheme is live, so the card matches what
                    tapping it produces rather than always showing the dark variant. */}
                <ThemePreview theme={t.id} scheme={resolvedScheme} />
                <div className="flex items-center gap-1 mt-1.5 px-0.5 min-w-0">
                  <span className={cn("text-[13px] font-medium truncate", on ? "text-fg" : "text-fg/80")}>
                    {t.label}
                  </span>
                  {on && <Check size={12} className="text-accent shrink-0 ml-auto" />}
                </div>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
