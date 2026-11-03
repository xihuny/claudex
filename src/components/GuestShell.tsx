import { m as motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { ChatView } from "@/components/ChatView";
import { GitButton } from "@/components/GitButton";
import { useMeStore } from "@/store/me";

// The entire app as a guest sees it: one header line and one chat pane.
//
// This is a separate shell rather than the normal one with pieces hidden, and that is the
// point - a guest can only reach what is mounted here, so a control added to Topbar,
// Sidebar or TabBar later cannot leak into a share by being forgotten. ChatView is reused
// as-is: boot leaves exactly one session in `openSlugs` (the share's), so it renders that
// one pane and nothing else.
export function GuestShell() {
  const me = useMeStore((s) => s.me);

  return (
    <>
      <header
        className="shrink-0 flex items-center gap-2.5 px-4 h-[52px] border-b border-border bg-frame"
        style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(52px + env(safe-area-inset-top))" }}
      >
        <div className="grid place-items-center w-7 h-7 rounded-md text-muted shrink-0">
          <Sparkles size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold leading-tight truncate">{me?.projectName || "Shared project"}</div>
          {me?.name && <div className="text-[12px] text-muted leading-tight truncate">Shared with {me.name}</div>}
        </div>
        {/* Only when the share allows git. Everything else in the owner's Topbar stays out
            of this shell entirely rather than being rendered and disabled. */}
        {me?.caps?.git && <GitButton />}
      </header>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
        className="relative flex-1 min-h-0 bg-bg"
      >
        <ChatView />
      </motion.div>
    </>
  );
}
