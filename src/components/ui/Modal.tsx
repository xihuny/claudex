import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, m as motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/** The on-screen keyboard shrinks the *visual* viewport but not the layout viewport, which is
 *  what `position: fixed` resolves against - so a centred fixed dialog stays put behind the
 *  keyboard. Mirroring visualViewport into an offset + height keeps the dialog inside the part
 *  of the screen you can actually see, and shrinks it so its body scrolls instead of hiding. */
function useVisualViewport(open: boolean) {
  const [vv, setVv] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const v = window.visualViewport;
    if (!open || !v) { setVv(null); return; }
    const sync = () => setVv({ top: v.offsetTop, height: v.height });
    sync();
    v.addEventListener("resize", sync);
    v.addEventListener("scroll", sync);
    return () => { v.removeEventListener("resize", sync); v.removeEventListener("scroll", sync); };
  }, [open]);
  return vv;
}

export function Modal({ open, onClose, title, subtitle, children, footer, className }: ModalProps) {
  const vv = useVisualViewport(open);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/55"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount onOpenAutoFocus={(e) => e.preventDefault()}>
              {/* Full-viewport centring box. It can't rely on `pointer-events-none` to pass
                  outside clicks down to the overlay: for a modal dialog Radix writes an inline
                  `pointer-events: auto` onto this node (react-dismissable-layer), which beats the
                  class. So the box does receive the click, and - being the Content node itself -                   Radix reads it as *inside* and never dismisses. Closing here on a click that
                  landed on the box rather than the panel is what restores tap-outside-to-close. */}
              <motion.div
                onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
                className="fixed inset-x-0 z-50 flex items-center justify-center px-3 py-3 h-[100dvh]"
                style={vv ? { top: vv.top, height: vv.height } : undefined}
                // Enters solid: with no backdrop blur, any fade-in let the sharp page show
                // through the dialog for a few frames (read as a flash). Only the exit fades.
                initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <motion.div
                  className={cn(
                    "pointer-events-auto flex flex-col max-h-full w-[min(480px,calc(100vw-24px))]",
                    "rounded-2xl border border-border bg-panel shadow-2xl shadow-black/50 overflow-hidden",
                    className,
                  )}
                  initial={{ opacity: 1, scale: 0.97, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 6 }}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                >
                  {title && (
                    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 shrink-0">
                      <div>
                        <Dialog.Title className="text-[17px] font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
                        {subtitle && <Dialog.Description className="text-[14px] text-muted mt-0.5">{subtitle}</Dialog.Description>}
                      </div>
                      <button onClick={onClose} className="text-muted hover:text-fg hover:bg-panel2 rounded-md transition-colors -mr-1 -mt-1 p-1">
                        <X size={20} />
                      </button>
                    </div>
                  )}
                  <div className="px-5 pb-2 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
                  {footer && <div className="flex items-center gap-2 px-5 py-4 border-t border-border mt-2 shrink-0">{footer}</div>}
                </motion.div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
