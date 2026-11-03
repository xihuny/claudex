import { avatarHue, initials, cn } from "@/lib/utils";

export function Avatar({ name, size = 30, className }: { name: string; size?: number; className?: string }) {
  const h = avatarHue(name);
  // A flat tint of the project's own hue, mixed against the palette so it stays pale on
  // light themes and dark on dark ones. Identity, not data: no gradient, no lift.
  return (
    <span
      className={cn("flex items-center justify-center font-semibold shrink-0 rounded-md", className)}
      style={{
        width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.4)),
        color: `color-mix(in srgb, hsl(${h} 70% 50%) 65%, var(--color-fg))`,
        background: `color-mix(in srgb, hsl(${h} 60% 50%) 20%, var(--color-panel))`,
      }}
    >
      {initials(name)}
    </span>
  );
}
