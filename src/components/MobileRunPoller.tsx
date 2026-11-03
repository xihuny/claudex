import { useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/store/store";
import { useMobileRun, type MStatus } from "@/store/mobileRun";

// Headless status poller for Flutter projects. Renders nothing in the header: all the
// controls live in MobileRunDock, the always-on bar under the chat/terminal pane.
// The server keeps the device list live via a persistent `flutter daemon`
// (connect/disconnect events), so polling /api/mobile/status here is just
// reading in-memory state - cheap even at a 2.5s cadence.

export function MobileRunPoller() {
  const active = useStore((s) => s.active);
  const phase = useMobileRun((s) => s.st?.run?.phase);
  const live = useMobileRun((s) => !!s.st?.run?.running);

  const refresh = useCallback(async () => {
    if (!active) return;
    try {
      const st = await api<MStatus>("GET", "/api/mobile/status?session=" + encodeURIComponent(active));
      useMobileRun.getState().setStatus(active, st);
    } catch {}
  }, [active]);

  useEffect(() => {
    refresh();
    // Faster while a launch is in progress so Gradle/Xcode progress lines stream in;
    // a live run keeps a 2.5s cadence so the dock's logs flow; idle just tracks devices.
    const i = setInterval(refresh, live ? (phase === "starting" ? 1500 : 2500) : 5000);
    return () => clearInterval(i);
  }, [refresh, live, phase]);

  // Leaving the project (or switching to a non-Flutter one) clears the bar.
  useEffect(() => () => { useMobileRun.getState().setStatus("", null); }, [active]);

  return null;
}
