import { Suspense, lazy, useEffect, useState } from "react";
import { LazyMotion } from "motion/react";
import { Toaster } from "sonner";
import { Login } from "@/components/Login";
import { Topbar } from "@/components/Topbar";
import { Sidebar } from "@/components/Sidebar";
import { TabBar } from "@/components/TabBar";
import { TerminalView } from "@/components/TerminalView";
import { ChatView } from "@/components/ChatView";
import { MobileRunDock } from "@/components/MobileRunDock";
import { KeyBar } from "@/components/KeyBar";
import { useStore, baseOf, GENERAL_SLUG } from "@/store/store";
import { useFilesPanel } from "@/store/panels";
import { useUI } from "@/store/ui";
import { useMeStore, useIsGuest, isGuest, type Me } from "@/store/me";
import { useTheme, watchSystemScheme } from "@/store/theme";
import { api, setUnauthorizedHandler, isShareUrl, ensureFileCookie } from "@/lib/api";
import * as terminals from "@/lib/terminals";
import * as chat from "@/lib/chat";
import { cn } from "@/lib/utils";

// Everything below opens from a button and is closed on a cold start, so none of it
// belongs in the first payload. Each is held unmounted until first opened (see
// useOpenedOnce) - `lazy()` alone wouldn't help, since these all used to render
// unconditionally and would fetch their chunk during boot anyway.
const FilesView = lazy(() => import("@/components/FilesView").then((m) => ({ default: m.FilesView })));
const SetupScreen = lazy(() => import("@/components/SetupScreen").then((m) => ({ default: m.SetupScreen })));
const CommandPalette = lazy(() => import("@/components/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const AddProjectDialog = lazy(() => import("@/components/AddProjectDialog").then((m) => ({ default: m.AddProjectDialog })));
const EditProjectDialog = lazy(() => import("@/components/EditProjectDialog").then((m) => ({ default: m.EditProjectDialog })));
// The guest shell is the whole app for an invited person and dead weight for the owner,
// so it loads only once /api/me says this session is a guest.
const GuestShell = lazy(() => import("@/components/GuestShell").then((m) => ({ default: m.GuestShell })));

// Motion's animation engine was ~45% of the entry chunk, loaded before first paint for
// animations that can't run until after it. Every component now imports `m` (aliased to
// `motion`, so the JSX is unchanged) - the ~6 kB component shell - and the real feature
// bundle arrives in its own chunk via this loader. Elements render at their `animate`
// state until it lands, so a slow fetch shows the finished layout, never a broken one.
const loadMotionFeatures = () => import("@/lib/motion-features").then((m) => m.default);

// Latch a panel's open state: false until it is first opened, true forever after.
// The panels are written to stay mounted while hidden on purpose - FilesView keeps its
// tree, scroll offset and open file alive that way - so they must not be unmounted
// on close. Latching preserves that exactly while still deferring the first fetch.
function useOpenedOnce(open: boolean) {
  const [opened, setOpened] = useState(open);
  useEffect(() => { if (open) setOpened(true); }, [open]);
  return opened;
}

// The app shell is one bottom-inset TALLER than the layout viewport - the only way its
// surfaces paint the home-indicator strip on iOS standalone (fixed boxes and 100dvh both stop
// at the safe line). That leaves a small real document scroll range, so: (1) block touch
// scrolling at the document level unless the gesture started inside an actually-scrollable
// element (chat transcript, terminal, lists all keep working), and (2) pin the window scroll
// back to 0 for anything non-touch (focus auto-scroll, etc.). Do NOT replace this with
// overflow:hidden on html/body (clips the strip → black bar) or by shrinking the heights
// (strip unpainted → black bar).
function useScrollPin() {
  useEffect(() => {
    const scrollableUnder = (start: EventTarget | null): boolean => {
      for (let n = start instanceof Element ? start : null; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n);
        const canY = /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1;
        const canX = /(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1;
        if (canY || canX || n instanceof HTMLTextAreaElement || n instanceof HTMLInputElement) return true;
      }
      return false;
    };
    const onTouchMove = (e: TouchEvent) => { if (!scrollableUnder(e.target)) e.preventDefault(); };
    const pin = () => { if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0); };
    pin();
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("scroll", pin, { passive: true });
    return () => {
      document.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("scroll", pin);
    };
  }, []);
}

// Hold the app at 1×. The viewport meta asks for `user-scalable=no`, but iOS Safari has
// ignored that since iOS 10 (it was being used to make text unreadably small), so a pinch
// still zooms the whole shell - and in a standalone PWA there is no visible chrome to
// pinch back out with, so a stray two-finger touch strands you at 2× with the composer
// off-screen. Each gesture that can zoom has to be refused individually:
//
//   - iOS reports pinch as its own non-standard `gesture*` events, not as touch events.
//   - Multi-touch elsewhere. The app has no two-finger gesture of its own, and the image
//     viewer computes its pinch from raw touch coordinates rather than the browser's zoom,
//     so preventDefault here doesn't disturb it (its own listeners still see the event - //     preventDefault isn't stopPropagation).
//   - A trackpad pinch, and ctrl/⌘+wheel, both arrive as a wheel event with ctrlKey set.
//   - ⌘/Ctrl with +, - or 0. Chrome honours preventDefault on these; Safari and Firefox
//     reserve them, so this last one is best-effort. Double-tap zoom is handled in CSS
//     (`touch-action` on html), which is the only mechanism that covers it.
function useNoZoom() {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    const onTouchMove = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
    const onWheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && ["+", "=", "-", "_", "0"].includes(e.key)) e.preventDefault();
    };
    const gestures = ["gesturestart", "gesturechange", "gestureend"];

    for (const g of gestures) document.addEventListener(g, stop, { passive: false });
    // Capture phase: a scroll container that handles touchmove itself must not get to
    // decide whether the page zooms.
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    window.addEventListener("keydown", onKey);
    return () => {
      for (const g of gestures) document.removeEventListener(g, stop);
      document.removeEventListener("touchmove", onTouchMove, { capture: true });
      document.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}

// Keyboard handling: when the iOS keyboard opens, the layout viewport doesn't resize - the
// visual viewport shrinks (and may pan, reported as vv.offsetTop). Shrink #app to the visual
// viewport AND translate it down by the pan offset so its bottom edge (the composer) sits
// exactly on top of the keyboard. Keyboard detection compares against the LARGEST viewport
// height ever seen (a stable baseline) - comparing against live window.innerHeight breaks on
// standalone PWAs where innerHeight itself can shrink with the keyboard.
function useViewportFix() {
  useEffect(() => {
    const el = document.getElementById("app");
    if (!el) return;
    let baseline = window.innerHeight;
    // Last known keyboard height (persisted) - lets us pre-shrink on focus BEFORE the
    // keyboard arrives, so iOS finds the input already visible and skips its whole-page
    // "push up" pan animation. Corrected to the exact size on the first resize event.
    let kbH = parseFloat(localStorage.getItem("cx_kb_h") || "") || 336;
    const apply = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      baseline = Math.max(baseline, window.innerHeight, vv.height);
      if (baseline - vv.height > 150) {   // keyboard open
        kbH = baseline - vv.height;
        localStorage.setItem("cx_kb_h", String(kbH));
        el.style.height = vv.height + "px";
        el.style.transform = `translateY(${vv.offsetTop}px)`;
        document.documentElement.dataset.kb = "1";   // collapses .kb-tight bottom padding (index.css)
      } else {
        el.style.height = "";
        el.style.transform = "";
        delete document.documentElement.dataset.kb;
      }
      const active = useStore.getState().active;
      if (active) terminals.resize(active);
    };
    // Pre-shrink #app BEFORE focus reaches iOS. UIKit snapshots the focused element's
    // position while processing the tap itself - before focusin handlers run - so reacting
    // to focus is always too late and iOS pans the whole layout. Composer taps are therefore
    // intercepted (ChatView dispatches "cx-preshrink", shrinks, THEN focuses), so the caret
    // is already above the keyboard when iOS looks. Shrink to the EXACT remembered keyboard
    // height - any overshoot makes the caret visibly jump high then settle back down.
    // If no keyboard shows within 800ms (hardware keyboard), the guess is undone.
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    let preTimer = 0;
    const preShrink = () => {
      if (!coarse || document.documentElement.dataset.kb) return;
      el.style.height = Math.max(220, baseline - kbH) + "px";
      document.documentElement.dataset.kb = "1";
      const active = useStore.getState().active;
      if (active) terminals.resize(active);
      clearTimeout(preTimer);
      preTimer = window.setTimeout(() => {
        const vv = window.visualViewport;
        if (vv && baseline - vv.height <= 150) apply();   // no keyboard came → restore
      }, 800);
    };
    // Fallback for inputs that aren't intercepted (settings, dialogs): shrink on focusin -     // late for the pan on those, but keeps the layout correct once the keyboard is up.
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !t.matches("textarea, input:not([type]), input[type='text'], input[type='password'], input[type='search'], input[type='email'], input[type='url'], input[type='number'], [contenteditable='true']")) return;
      preShrink();
    };
    const onPre = () => preShrink();
    apply();
    window.addEventListener("cx-preshrink", onPre);
    document.addEventListener("focusin", onFocusIn);
    window.visualViewport?.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("scroll", apply);
    return () => {
      clearTimeout(preTimer);
      window.removeEventListener("cx-preshrink", onPre);
      document.removeEventListener("focusin", onFocusIn);
      window.visualViewport?.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("scroll", apply);
    };
  }, []);
}

// Report which session the user is actively viewing so the server can mute its pushes.
// "Viewing" means present, not merely "tab open": visible + window-focused + some input
// within IDLE_MS. The idle timeout is what lets a laptop you've walked away from stop
// suppressing, so notifications resume on your phone. A heartbeat re-asserts presence so
// the server's TTL can expire a client that sleeps/freezes without cleanly disconnecting.
// In-app counterpart to push: when a turn finishes for a session you're NOT currently on,
// pulse that project's sidebar capsule instead of buzzing you. Selecting it clears the cue
// (setActive does that). If it's already the active project, there's nothing to signal.
function useFinishAttention() {
  useEffect(() => {
    chat.setChatFinishHandler((slug) => {
      const base = baseOf(slug);
      const active = useStore.getState().active;
      if (active && baseOf(active) === base) return;
      useStore.getState().flagAttention(base);
    });
    return () => chat.setChatFinishHandler(null);
  }, []);
}

function useViewingReporter() {
  useEffect(() => {
    const IDLE_MS = 60000, HEARTBEAT_MS = 25000;
    let idleAt = Date.now();
    let reported: string | null = null;
    let idleTimer = 0, lastArm = 0;

    const present = () => !document.hidden && document.hasFocus() && Date.now() - idleAt < IDLE_MS;
    const report = () => {
      const slug = present() ? useStore.getState().active : null;
      reported = slug;
      terminals.setViewing(slug);
      chat.setViewing(slug);
    };
    const armIdle = () => { clearTimeout(idleTimer); idleTimer = window.setTimeout(report, IDLE_MS); };
    // Cheap per-event handler: pointermove fires a lot, so only re-arm the idle timer once
    // a second; wake immediately (report + arm) when returning from an away/idle state.
    const onActivity = () => {
      const now = Date.now();
      idleAt = now;
      if (reported == null) { report(); armIdle(); lastArm = now; return; }
      if (now - lastArm >= 1000) { lastArm = now; armIdle(); }
    };

    report();
    armIdle();
    const hb = window.setInterval(report, HEARTBEAT_MS);
    const acts = ["mousedown", "keydown", "touchstart", "pointermove", "wheel", "scroll"];
    for (const e of acts) window.addEventListener(e, onActivity, { passive: true });
    document.addEventListener("visibilitychange", report);
    window.addEventListener("focus", report);
    window.addEventListener("blur", report);
    let lastActive = useStore.getState().active;
    const unsub = useStore.subscribe(() => { const a = useStore.getState().active; if (a !== lastActive) { lastActive = a; report(); } });

    return () => {
      clearInterval(hb); clearTimeout(idleTimer);
      for (const e of acts) window.removeEventListener(e, onActivity);
      document.removeEventListener("visibilitychange", report);
      window.removeEventListener("focus", report);
      window.removeEventListener("blur", report);
      unsub();
    };
  }, []);
}

// Cmd/Ctrl+K lives here rather than inside CommandPalette: the palette is only mounted
// once it has been opened, so the shortcut that opens it can't be owned by it.
function usePaletteShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      const ui = useUI.getState();
      ui.setPalette(!ui.paletteOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// Cmd/Ctrl + ] / [ cycles between the sessions of the active project.
function useSessionShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== "]" && e.key !== "[")) return;
      const st = useStore.getState();
      if (!st.active) return;
      const sessions = st.sessionsOf(baseOf(st.active));
      if (sessions.length < 2) return;
      e.preventDefault();
      const idx = sessions.findIndex((s) => s.slug === st.active);
      const delta = e.key === "]" ? 1 : -1;
      st.openSession(sessions[(idx + delta + sessions.length) % sessions.length].slug);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// Shown when a /s/<token> link no longer authenticates - revoked, or the project behind
// it was deleted. Both cases are the owner's to fix, so the only useful action is to say so.
function DeadShare() {
  return (
    <div className="fixed inset-0 mesh flex items-center justify-center p-6">
      <div className="w-[min(380px,100%)] rounded-2xl border border-border bg-panel p-7 text-center">
        <h1 className="text-lg font-semibold">This link isn't active</h1>
        <p className="text-[13px] text-muted mt-2 leading-relaxed">
          The share was turned off, or the project it pointed to is gone. Ask whoever sent it
          for a new link.
        </p>
      </div>
    </div>
  );
}

// KeyBar is terminal-only; chat mode has its own input bar. It's also suppressed while
// the files panel is up - it covers the pane, so terminal keys would be orphaned.
function ModeAwareKeyBar() {
  const chat = useStore((s) => (s.active ? (s.mode[s.active] || "chat") : "chat") === "chat");
  const filesOpen = useFilesPanel((s) => s.open);
  return chat || filesOpen ? null : <KeyBar />;
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const guest = useIsGuest();
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  useScrollPin();
  useNoZoom();
  useViewportFix();
  useViewingReporter();
  useFinishAttention();
  usePaletteShortcut();
  useSessionShortcuts();
  useEffect(watchSystemScheme, []);

  // Sonner paints its own surfaces rather than using the app's classes, so the scheme
  // has to be handed to it explicitly.
  const resolvedScheme = useTheme((s) => s.resolvedScheme);

  // Which deferred surfaces have been opened at least once, and so should be in the tree.
  const filesMounted = useOpenedOnce(useFilesPanel((s) => s.open));
  const setupMounted = useOpenedOnce(useUI((s) => s.setupOpen));
  const paletteMounted = useOpenedOnce(useUI((s) => s.paletteOpen));
  const addMounted = useOpenedOnce(useUI((s) => s.addOpen));
  const editMounted = useOpenedOnce(useUI((s) => s.editProject !== null));

  async function boot() {
    const store = useStore.getState();
    try {
      // Identity first: everything below branches on it, and it's also the cheapest
      // request that can tell us the stored token is stale (401 → the login screen).
      const me = await api<Me>("GET", "/api/me");
      useMeStore.getState().setMe(me);
      ensureFileCookie();   // gates <img src> and downloads; not awaited, nothing below needs it
      const projects = await store.loadProjects();
      if (me.role === "guest" && me.session) {
        // A share is exactly one project and one session. Pin the tab list to it rather
        // than restoring whatever this browser had open - that state may predate the
        // share, or belong to a different one on the same device.
        useStore.setState({ openSlugs: [me.session], active: me.session, mode: { [me.session]: "chat" } });
        setAuthed(true);
        return;
      }
      store.loadConfig();
      // Keep open session slugs whose project still exists (a slug may be a child
      // session like "proj::2", so validate by its base project slug).
      const valid = new Set(projects.map((p) => p.session));
      const open = store.openSlugs.filter((s) => valid.has(baseOf(s)) || baseOf(s) === GENERAL_SLUG);
      // Resume the *last-selected* session (which may be a non-main session like
      // "proj::2"), not merely the last-opened tab. Fall back to the newest open tab
      // if the saved one was since closed.
      let active: string | null = null;
      try { active = JSON.parse(localStorage.getItem("cx_active") || "null"); } catch {}
      if (!active || !open.includes(active)) active = open[open.length - 1] ?? null;
      useStore.setState({ openSlugs: open, active });
      localStorage.setItem("cx_open", JSON.stringify(open));
      setAuthed(true);
    } catch {
      setAuthed(false);
    }
  }

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    // xterm is no longer in the first payload; warm it once the app goes idle so
    // switching a session to terminal mode still opens without a visible wait. Guests
    // have no terminal at all, so for them it would be a pure download for nothing.
    boot().then(() => { if (!isGuest()) terminals.prefetchTerminal(); });
  }, []);

  return (
    // `strict` is deliberately off. Its only effect is to THROW when a full `motion.*`
    // component is rendered in here instead of `m` - a useful guard against silently
    // undoing this split later, but a hard crash if one is ever missed. Turn it on once
    // you've clicked through the app and confirmed the animations still look right.
    <LazyMotion features={loadMotionFeatures}>
      {/* No shell-level bottom padding: each bottom-most element (composer, KeyBar, drawer
          & settings footers) pads itself with env(safe-area-inset-bottom), swap-style, so
          both in-flow content and absolute overlays clear the home indicator consistently. */}
      <div id="app" className="relative h-[calc(100dvh_+_env(safe-area-inset-bottom))] flex flex-col overflow-hidden bg-bg text-fg">
        {/* A guest gets its own shell, not this one with pieces hidden - see GuestShell. */}
        {authed && guest && (
          <Suspense fallback={null}>
            <GuestShell />
          </Suspense>
        )}

        {authed && !guest && (
          <>
            <Topbar onOpenSettings={() => useUI.getState().openSetup()} />
            {/* Desktop: Topbar + Sidebar form one tinted frame and <main> is the sheet inside
                it, inset 8px from the right and bottom. On a phone the frame falls away and
                the sheet is the whole screen (no inset, so the safe-area chain is untouched). */}
            <div className="flex-1 flex min-h-0 min-w-0 md:bg-frame">
              <Sidebar />
              <main className={cn(
                "flex-1 flex flex-col min-w-0 min-h-0 bg-bg md:mr-2 md:mb-2 md:rounded-2xl md:border md:border-border md:overflow-hidden",
                sidebarCollapsed && "md:ml-2",
              )}>
                <TabBar />
                <div className="relative flex-1 min-h-0 bg-bg">
                  <TerminalView />
                  <ChatView />
                  {/* Overlay panel. Paints over the two views above when open (z-10), so
                      neither view needed any awareness of it. Code-split; enters the tree
                      on first open. */}
                  <Suspense fallback={null}>
                    {filesMounted && <FilesView />}
                  </Suspense>
                </div>
                <MobileRunDock />
                <ModeAwareKeyBar />
              </main>
            </div>
            <Suspense fallback={null}>
              {addMounted && <AddProjectDialog />}
              {editMounted && <EditProjectDialog />}
              {setupMounted && <SetupScreen />}
              {paletteMounted && <CommandPalette />}
            </Suspense>
          </>
        )}

        {/* A dead share link gets an explanation, not the owner's password box - a guest
            has no password to type, and offering one just looks like a locked door. */}
        {authed === false && (isShareUrl() ? <DeadShare /> : <Login onSuccess={() => boot()} />)}

        {/* Top, not bottom: the bottom edge is the composer, the KeyBar and the iOS keyboard,
            and a toast parked there covers the one control you're reaching for. The offset
            clears the 52px Topbar (plus its safe-area padding) so toasts sit under the header
            rather than over it, and swiping up dismisses them away from the thumb. */}
        <Toaster theme={resolvedScheme} position="top-center" visibleToasts={3}
          swipeDirections={["top", "left", "right"]}
          offset={{ top: "calc(52px + env(safe-area-inset-top) + 10px)" }}
          mobileOffset={{ top: "calc(52px + env(safe-area-inset-top) + 8px)", left: "12px", right: "12px" }}
          toastOptions={{
          style: { background: "var(--color-panel2)", border: "1px solid var(--color-border)", color: "var(--color-fg)" },
        }} />
      </div>
    </LazyMotion>
  );
}
