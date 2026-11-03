import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, m as motion } from "motion/react";
import { Plus, Settings, SquareTerminal } from "lucide-react";
import { useStore } from "@/store/store";
import { useUI } from "@/store/ui";
import { Avatar } from "@/components/Avatar";

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setPalette = useUI((s) => s.setPalette);
  const projects = useStore((s) => s.projects);
  const openProject = useStore((s) => s.openProject);
  const openAdd = useUI((s) => s.openAdd);
  const openSetup = useUI((s) => s.openSetup);

  // The Cmd/Ctrl+K toggle lives in App (usePaletteShortcut) - this component is lazy and
  // isn't mounted until the palette has been opened at least once, so it can't own the
  // binding that opens it.
  const run = (fn: () => void) => { fn(); setPalette(false); };

  return (
    <Dialog.Root open={open} onOpenChange={setPalette}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[80] bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="fixed left-1/2 top-[18%] z-[80] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 rounded-2xl border border-border bg-panel shadow-2xl shadow-black/50 overflow-hidden"
                // Enters solid (no fade): see the note in ui/Modal.tsx.
                initial={{ opacity: 1, scale: 0.97, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              >
                <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                <Command className="outline-none">
                  <Command.Input autoFocus placeholder="Search projects or actions…"
                    className="w-full h-14 px-4 bg-transparent border-b border-border text-[15px] outline-none placeholder:text-muted" />
                  <Command.List className="max-h-[340px] overflow-y-auto p-2">
                    <Command.Empty className="py-8 text-center text-sm text-muted">No results.</Command.Empty>
                    <Command.Group heading="Projects" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
                      {projects.map((p) => (
                        <Item key={p.session} onSelect={() => run(() => openProject(p.session))}>
                          <Avatar name={p.name} size={24} /> {p.name}
                          {p.group && <span className="ml-auto text-[12px] text-muted">{p.group}</span>}
                        </Item>
                      ))}
                    </Command.Group>
                    <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
                      <Item onSelect={() => run(openAdd)}><Plus size={16} className="text-muted" /> Add project</Item>
                      <Item onSelect={() => run(openSetup)}><Settings size={16} className="text-muted" /> Setup & status</Item>
                    </Command.Group>
                  </Command.List>
                </Command>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item onSelect={onSelect}
      className="flex items-center gap-2.5 px-2.5 h-10 rounded-md text-[14px] cursor-pointer data-[selected=true]:bg-panel2 outline-none">
      {children}
    </Command.Item>
  );
}
