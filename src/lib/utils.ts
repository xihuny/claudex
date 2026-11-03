import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string) {
  const parts = name.trim().split(/[\s\-_.]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.trim().slice(0, 2)).toUpperCase();
}

export function avatarHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
