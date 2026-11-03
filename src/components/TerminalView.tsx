import { useEffect, useRef } from "react";
import { m as motion, AnimatePresence } from "motion/react";
import { TerminalSquare } from "lucide-react";
import { useStore } from "@/store/store";
import * as terminals from "@/lib/terminals";

function TermPane({ slug, visible }: { slug: string; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) terminals.mount(slug, ref.current);
    // Unmount = left terminal mode (or closed the tab): end the CLI session so the
    // shared conversation is free for chat to resume.
    return () => { terminals.end(slug); };
  }, [slug]);
  useEffect(() => {
    if (visible) requestAnimationFrame(() => { terminals.resize(slug); terminals.focus(slug); });
  }, [visible, slug]);
  return (
    <div
      ref={ref}
      onClick={() => terminals.focus(slug)}
      className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-3xl"
      style={{ visibility: visible ? "visible" : "hidden", zIndex: visible ? 1 : 0 }}
    />
  );
}

export function TerminalView() {
  const openSlugs = useStore((s) => s.openSlugs);
  const active = useStore((s) => s.active);
  const mode = useStore((s) => s.mode);

  // keep terminals resized to container
  useEffect(() => {
    const onResize = () => active && terminals.resize(active);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [active]);

  return (
    <>
      {openSlugs.filter((slug) => (mode[slug] || "chat") === "terminal").map((slug) => (
        <TermPane key={slug} slug={slug} visible={slug === active} />
      ))}
      <AnimatePresence>
        {openSlugs.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 grid place-items-center mesh"
          >
            <div className="flex flex-col items-center gap-3 text-muted">
              <TerminalSquare size={40} strokeWidth={1.4} className="opacity-50" />
              <p className="text-sm">Pick a project to open a terminal</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
