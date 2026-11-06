// Settings - a hub of sections rather than one long scroll. The hub lists what each
// section is and its current state; tapping one slides in just that section. Panes are
// self-contained so adding one is a single entry in PANES + a component below.
import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, m as motion } from "motion/react";
import {
  ArrowLeft, RotateCw, ExternalLink, Bell, Globe, Server, Info, Activity, Copy, Palette, Brain, KeyRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api";
import { useUI } from "@/store/ui";
import type { SetupState } from "@/types";
import { cn } from "@/lib/utils";
import { Card, HubCard, Note, Row, Toggle } from "@/components/settings/parts";
import { VpsGuide } from "@/components/settings/VpsGuide";
import { AppearancePane } from "@/components/settings/AppearancePane";
import { ModelPane } from "@/components/settings/ModelPane";
import { BillingPane, type Billing } from "@/components/settings/BillingPane";
import { modelLabelFor, effortLabel } from "@/lib/models";
import { useTheme, THEMES } from "@/store/theme";
import { ALL_STEP_IDS, loadDoneIds } from "@/components/settings/guide";

type PaneId = "appearance" | "model" | "billing" | "status" | "access" | "notify" | "vps" | "about";

const PANE_TITLES: Record<PaneId, string> = {
  appearance: "Appearance",
  model: "Model",
  billing: "API billing",
  status: "System status",
  access: "Public access",
  notify: "Notifications",
  vps: "Deploy on a VPS",
  about: "About this build",
};

/** Actions that shell out through sudo - they need the account password. */
const SUDO = ["boot-enable", "nosleep-on"];

/** [in-flight, succeeded] toast text per setup action. */
const ACT_LABELS: Record<string, [string, string]> = {
  "boot-enable": ["Enabling start at login…", "Starts at login"],
  "nosleep-on": ["Disabling sleep…", "Sleep disabled"],
  "nosleep-off": ["Re-enabling sleep…", "Sleep re-enabled"],
  "install-cloudflared": ["Installing cloudflared…", "cloudflared installed"],
  "tunnel-restart": ["Restarting the tunnel…", "Tunnel restarted"],
  "install-hooks": ["Installing Claude hooks…", "Claude hooks installed"],
};

interface Ctx {
  s: SetupState | null;
  refresh: () => void;
  run: (act: string) => void;
  goto: (p: PaneId) => void;
}

// ── shell ─────────────────────────────────────────────────────────────────────

export function SetupScreen() {
  const open = useUI((s) => s.setupOpen);
  const close = useUI((s) => s.closeSetup);
  const [s, setS] = useState<SetupState | null>(null);
  const [pane, setPane] = useState<PaneId | null>(null);
  const [pw, setPw] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => { try { setS(await api<SetupState>("GET", "/api/setup")); } catch {} }, []);
  useEffect(() => { if (open) refresh(); }, [open, refresh]);
  // Always land on the hub, never on whatever was open last time.
  useEffect(() => { if (open) setPane(null); }, [open]);
  // Each pane starts at the top - carrying the previous scroll offset into a shorter
  // pane strands you mid-content with no visible header.
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [pane]);

  // Esc backs out one level: pane → hub → closed.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pane) setPane(null); else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pane, close]);

  const run = useCallback(async (act: string) => {
    if (act === "guide-claude") { window.open("https://docs.claude.com/en/docs/claude-code/setup", "_blank"); return; }
    if (SUDO.includes(act) && !pw) { toast.error("Enter your account password first."); return; }
    // These run as root on the host and print nowhere you can see, so the toast is the
    // whole report - name the action instead of the old "Working…" → "Done", which left
    // you guessing which button you'd pressed by the time it resolved.
    const [busyLabel, doneLabel] = ACT_LABELS[act] ?? ["Working…", "Done"];
    const id = toast.loading(busyLabel);
    try {
      const r = await api<{ ok: boolean; err?: string; out?: string }>("POST", "/api/setup/run", { action: act, password: pw });
      if (r.ok) toast.success(doneLabel, { id });
      else toast.error(r.err || r.out || "Failed", { id });
    } catch (e) { toast.error((e as Error).message, { id }); }
    refresh();
  }, [pw, refresh]);

  const ctx: Ctx = { s, refresh, run, goto: setPane };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-50 flex flex-col bg-bg"
          // Solid in, gone at once on close: any cross-fade shows the app through this
          // full-screen surface for a few hundred ms, which reads as a flash.
          initial={{ opacity: 1, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, transition: { duration: 0 } }}
          transition={{ type: "spring", stiffness: 340, damping: 34 }}
        >
          <header className="shrink-0 border-b border-border pt-[env(safe-area-inset-top)]">
            <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
              <div className="flex items-center gap-3 h-14">
                <button
                  onClick={() => (pane ? setPane(null) : close())}
                  title={pane ? "Back to settings" : "Close"}
                  className="grid place-items-center w-9 h-9 -ml-1.5 rounded-lg text-muted hover:text-fg hover:bg-panel2 transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
                <div className="flex-1 min-w-0">
                  <h1 className="text-[17px] font-semibold leading-tight truncate">
                    {pane ? PANE_TITLES[pane] : "Settings"}
                  </h1>
                  {pane && <div className="text-[12px] text-muted leading-tight">Settings</div>}
                </div>
                <button
                  onClick={refresh} title="Re-check"
                  className="grid place-items-center w-9 h-9 -mr-1.5 rounded-lg text-muted hover:text-fg hover:bg-panel2 transition-colors"
                >
                  <RotateCw size={17} />
                </button>
              </div>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 py-4 pb-[calc(1.5rem_+_env(safe-area-inset-bottom))]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={pane ?? "hub"}
                  initial={{ opacity: 0, x: pane ? 16 : -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: pane ? -12 : 12 }}
                  transition={{ duration: 0.16 }}
                >
                  {pane === null && <Hub {...ctx} />}
                  {pane === "appearance" && <AppearancePane />}
                  {pane === "model" && <ModelPane />}
                  {pane === "billing" && <BillingPane />}
                  {pane === "status" && <StatusPane {...ctx} pw={pw} setPw={setPw} />}
                  {pane === "access" && <AccessPane {...ctx} />}
                  {pane === "notify" && <NotifyPane {...ctx} />}
                  {pane === "vps" && <VpsGuide />}
                  {pane === "about" && <AboutPane {...ctx} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── hub ───────────────────────────────────────────────────────────────────────

function Hub({ s, goto }: Ctx) {
  // Recomputed on every mount of the hub, so returning from the guide shows fresh progress.
  const [vpsDone] = useState(() => loadDoneIds().length);
  // The hub shows what a new chat would start on, so the chip has to come from the
  // server's resolved default (a pick here, else settings.json / the plan default).
  const [modelChip, setModelChip] = useState("…");
  useEffect(() => {
    (async () => {
      try {
        const c = await api<{ defaultModel: string | null; defaultEffort: string | null; model: string | null }>("GET", "/api/config");
        const eff = effortLabel(c.defaultEffort);
        setModelChip(modelLabelFor(c.defaultModel || c.model) + (eff ? ` · ${eff}` : ""));
      } catch { setModelChip(" - "); }
    })();
  }, []);
  const [billing, setBilling] = useState<Billing | null>(null);
  useEffect(() => { api<Billing>("GET", "/api/apikey").then(setBilling).catch(() => {}); }, []);
  const checks = healthChecks(s);
  const ok = checks.filter((c) => c.ok).length;
  const allOk = checks.length > 0 && ok === checks.length;
  const themeId = useTheme((st) => st.theme);
  const resolvedScheme = useTheme((st) => st.resolvedScheme);
  const themeLabel = `${THEMES.find((t) => t.id === themeId)?.label ?? " - "} · ${resolvedScheme}`;

  const sections: { id: PaneId; icon: LucideIcon; title: string; desc: string; chip?: string; tone?: "ok" | "warn" | "muted" }[] = [
    {
      id: "appearance", icon: Palette, title: "Appearance",
      desc: "Theme, light or dark, motion",
      chip: themeLabel, tone: "muted",
    },
    {
      id: "model", icon: Brain, title: "Model",
      desc: "Default model and effort for new chats",
      chip: modelChip, tone: "muted",
    },
    {
      id: "billing", icon: KeyRound, title: "API billing",
      desc: "Continue on API balance when the subscription runs out",
      chip: !billing ? "…" : billing.enabled ? "API" : billing.hasKey ? "Subscription" : "No key",
      tone: billing?.enabled ? "warn" : "muted",
    },
    {
      id: "status", icon: Activity, title: "System status",
      desc: "Claude CLI, dependencies, always-on service",
      chip: s ? `${ok}/${checks.length}` : "…", tone: !s ? "muted" : allOk ? "ok" : "warn",
    },
    {
      id: "access", icon: Globe, title: "Public access",
      desc: s?.cfUrl ? s.cfUrl.replace("https://", "") : "Cloudflare tunnel and previews",
      chip: s ? (s.cfRunning ? "Live" : s.cfInstalled ? "Off" : "Not set up") : "…",
      tone: !s ? "muted" : s.cfRunning ? "ok" : "warn",
    },
    {
      id: "notify", icon: Bell, title: "Notifications",
      desc: "Get pinged when Claude finishes or needs you",
      chip: localStorage.getItem("cx_push") === "1" ? "On" : "Off",
      tone: localStorage.getItem("cx_push") === "1" ? "ok" : "muted",
    },
    {
      id: "vps", icon: Server, title: "Deploy on a VPS",
      desc: "Step-by-step guide to run Claudex 24/7",
      chip: `${vpsDone}/${ALL_STEP_IDS.length}`,
      tone: vpsDone === ALL_STEP_IDS.length ? "ok" : "muted",
    },
    {
      id: "about", icon: Info, title: "About this build",
      desc: `Build ${__APP_BUILD__}`, tone: "muted",
    },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      {s?.cfUrl && (
        <a href={s.cfUrl} target="_blank" rel="noreferrer"
          className="flex items-center gap-2 px-3.5 py-3 rounded-xl bg-panel text-[14px] transition-colors hover:bg-panel2">
          <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
          <span className="text-muted shrink-0">Reachable at</span>
          <span className="text-fg font-medium truncate">{s.cfUrl.replace("https://", "")}</span>
          <ExternalLink size={14} className="ml-auto text-muted shrink-0" />
        </a>
      )}
      {sections.map((sec) => (
        <HubCard key={sec.id} icon={sec.icon} title={sec.title} desc={sec.desc}
          chip={sec.chip} tone={sec.tone} onClick={() => goto(sec.id)} />
      ))}
    </div>
  );
}

// ── status ────────────────────────────────────────────────────────────────────

interface Check { key: string; ok: boolean; title: string; desc: string; act?: string; label?: string; soft?: boolean }

/** The health checks that are meaningful on this host's platform. */
function healthChecks(s: SetupState | null): Check[] {
  if (!s) return [];
  const out: Check[] = [
    { key: "claude", ok: !!s.claude, title: "Claude Code CLI", desc: s.claude || "Not detected", act: s.claude ? undefined : "guide-claude", label: "Install help", soft: true },
    { key: "deps", ok: s.deps, title: "App dependencies", desc: s.deps ? "Installed" : "Missing" },
    { key: "pm2", ok: s.pm2Managed, title: "Always-on service", desc: s.pm2Managed ? "Supervised by PM2" : "Not running under PM2", act: s.pm2Managed ? undefined : "pm2-save", label: "Enable" },
  ];
  // boot + sleep are wired through launchd/pmset, so they only apply to a Mac host.
  // On Linux the equivalent (a pm2 systemd unit) is a guide step, not a button.
  if (s.mac) {
    out.push(
      { key: "boot", ok: s.bootEnabled, title: "Launch on startup", desc: s.bootEnabled ? "Enabled" : "Survive reboots (needs password)", act: s.bootEnabled ? undefined : "boot-enable", label: "Enable" },
      { key: "awake", ok: !!(s.awake || s.noSleep), title: "Keep the Mac awake", desc: (s.awake || s.noSleep) ? "Sleep disabled" : "So it stays reachable", act: (s.awake || s.noSleep) ? undefined : "nosleep-on", label: "Enable" },
    );
  }
  return out;
}

function StatusPane({ s, run, goto, pw, setPw }: Ctx & { pw: string; setPw: (v: string) => void }) {
  const checks = healthChecks(s);
  const needsPw = checks.some((c) => !c.ok && c.act && SUDO.includes(c.act));

  return (
    <div className="flex flex-col gap-3">
      <Card title="Health" hint={s ? `${checks.filter((c) => c.ok).length}/${checks.length}` : undefined}>
        {checks.map((c) => (
          <Row key={c.key} ok={c.ok} title={c.title} desc={c.desc}>
            {!c.ok && c.act && (
              <Button size="sm" variant={c.soft ? "soft" : "primary"} onClick={() => run(c.act!)} className="h-7 px-2.5 text-xs shrink-0">
                {c.label}
              </Button>
            )}
          </Row>
        ))}
        {!s && <Row title="Checking…" desc="Reading host state" />}
      </Card>

      {needsPw && (
        <div className="flex flex-col gap-1.5">
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Account password" className="h-10 text-sm" />
          <p className="px-1 text-[12px] text-muted">
            Used once, over localhost, to run the <code className="font-mono text-fg/75">sudo</code> step above. It's never stored.
          </p>
        </div>
      )}

      {s && !s.mac && (
        <Note kind="info">
          Autostart on this host is a PM2 systemd unit, not a button - it's registered once with
          <code> pm2 startup systemd</code>.{" "}
          <button onClick={() => goto("vps")} className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg">See the VPS guide →</button>
        </Note>
      )}

      <Card title="Host">
        <Row title="Platform" desc={s ? `${s.platform}${s.mac ? " (macOS)" : ""}` : "…"} mono />
        <Row title="Node" desc={s?.node || "…"} mono />
      </Card>
    </div>
  );
}

// ── public access ─────────────────────────────────────────────────────────────

function AccessPane({ s, run, goto }: Ctx) {
  const copyUrl = () => {
    if (!s?.cfUrl) return;
    navigator.clipboard?.writeText(s.cfUrl).then(() => toast.success("Link copied")).catch(() => {});
  };

  return (
    <div className="flex flex-col gap-3">
      {s?.cfUrl ? (
        <div className="rounded-2xl bg-panel px-4 py-3.5">
          <div className="text-[12px] font-medium text-muted">Public URL</div>
          <div className="mt-1 flex items-center gap-2">
            <a href={s.cfUrl} target="_blank" rel="noreferrer" className="flex-1 min-w-0 text-[16px] font-medium text-fg truncate hover:underline">
              {s.cfUrl.replace("https://", "")}
            </a>
            <button onClick={copyUrl} title="Copy"
              className="grid place-items-center w-8 h-8 rounded-md text-muted hover:text-fg hover:bg-panel2 transition-colors">
              <Copy size={14} />
            </button>
          </div>
          <p className="mt-1.5 text-[12px] text-muted">
            Password-gated. Read from the first <code className="font-mono text-fg/75">hostname:</code> in{" "}
            <code className="font-mono text-fg/75">~/.cloudflared/claudex.yml</code>.
          </p>
        </div>
      ) : (
        <Note kind="info">No hostname found in <code>~/.cloudflared/claudex.yml</code> yet - the tunnel isn't configured on this host.</Note>
      )}

      <Card title="Cloudflare tunnel">
        <Row ok={s?.cfInstalled} title="cloudflared installed" desc={s?.cfInstalled ? "Found on PATH" : "Required for public access"}>
          {s && !s.cfInstalled && s.mac && (
            <Button size="sm" onClick={() => run("install-cloudflared")} className="h-7 px-2.5 text-xs shrink-0">Install</Button>
          )}
        </Row>
        <Row ok={s?.cfRunning} title="Tunnel running" desc={s?.cfRunning ? "Serving the public URL" : "Not currently connected"}>
          {s?.cfInstalled && (
            <Button size="sm" variant={s.cfRunning ? "soft" : "primary"} onClick={() => run("tunnel-restart")} className="h-7 px-2.5 text-xs shrink-0">
              {s.cfRunning ? "Restart" : "Start"}
            </Button>
          )}
        </Row>
      </Card>

      {s && !s.cfInstalled && !s.mac && (
        <Note kind="info">
          Install it with the <code>.deb</code> from Cloudflare's releases - covered in the VPS guide.{" "}
          <button onClick={() => goto("vps")} className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg">Go to step →</button>
        </Note>
      )}

      <Card title="Project previews">
        <div className="px-2 py-2 flex flex-col gap-2">
          <p className="text-[14px] leading-relaxed text-muted">
            Run project → Expose publishes a project's dev server. With a preview domain configured,
            each one gets a stable <code className="font-mono text-[12px] text-fg/85">dev-&lt;project&gt;</code> subdomain
            served through this same tunnel. Without one, previews fall back to random
            <code className="font-mono text-[12px] text-fg/85"> trycloudflare.com</code> URLs.
          </p>
          <button onClick={() => goto("vps")} className="self-start text-[13px] text-fg underline decoration-border underline-offset-2 hover:decoration-fg">
            How to set up preview subdomains →
          </button>
        </div>
      </Card>
    </div>
  );
}

// ── notifications ─────────────────────────────────────────────────────────────

interface PushSettings { onFinish: boolean; onInput: boolean; muteWhenViewing: boolean }

function urlB64ToU8(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function NotifyPane({ s, refresh }: Ctx) {
  const [on, setOn] = useState(() => localStorage.getItem("cx_push") === "1");
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<PushSettings | null>(null);
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  useEffect(() => { if (on) api<PushSettings>("GET", "/api/push/settings").then(setCfg).catch(() => {}); }, [on]);

  // Reconcile UI state. getSubscription() can transiently return null on iOS PWAs, so we
  // only flip OFF when permission is actually gone - a confirmed subscription flips ON,
  // otherwise we trust the last user action (persisted in localStorage).
  useEffect(() => {
    if (!supported) { setOn(false); return; }
    if (Notification.permission !== "granted") { setOn(false); localStorage.setItem("cx_push", "0"); return; }
    navigator.serviceWorker.getRegistration()
      .then((r) => r?.pushManager.getSubscription())
      .then((sub) => { if (sub) { setOn(true); localStorage.setItem("cx_push", "1"); } })
      .catch(() => {});
  }, [supported]);

  const setCfgKey = async (k: keyof PushSettings, v: boolean) => {
    setCfg((c) => (c ? { ...c, [k]: v } : c));
    try { setCfg(await api<PushSettings>("POST", "/api/push/settings", { [k]: v })); }
    // Put the switch back on failure. Without this the toggle keeps showing the value the
    // server just refused, and the toast reads as a glitch rather than a rejection.
    catch (e) { setCfg((c) => (c ? { ...c, [k]: !v } : c)); toast.error((e as Error).message); }
  };

  async function enable() {
    setBusy(true);
    try {
      if (!supported) { toast.error("Push isn't supported in this browser"); return; }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) { toast.error("Open the built app, not the dev URL"); return; }
      if ((await Notification.requestPermission()) !== "granted") { toast.error("Notification permission was not granted"); return; }
      const { key } = await api<{ key: string }>("GET", "/api/push/key");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(key) });
      await api("POST", "/api/push/subscribe", JSON.parse(JSON.stringify(sub)));
      localStorage.setItem("cx_push", "1"); setOn(true);
      await api("POST", "/api/setup/run", { action: "install-hooks" }).catch(() => {});  // wire Claude's Stop/Notification → push
      refresh();
      toast.success("Notifications on for this device");
    } catch (e) { toast.error("Enable failed: " + ((e as Error).message || String(e))); }
    finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true);
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { await api("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      localStorage.setItem("cx_push", "0"); setOn(false); toast.success("Notifications off");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function installHooks() {
    try { await api("POST", "/api/setup/run", { action: "install-hooks" }); refresh(); toast.success("Claude hooks installed"); }
    catch (e) { toast.error((e as Error).message); }
  }

  async function test() {
    try {
      const r = await api<{ ok: boolean; sent?: number; failed?: number; reason?: string; error?: string }>("POST", "/api/push/test");
      if (r.ok) toast.success(`Test sent to ${r.sent} device${r.sent === 1 ? "" : "s"}${r.failed ? ` · ${r.failed} failed` : ""}`);
      else toast.error(r.reason ? `Push rejected: ${r.reason}` : r.error || "Failed");
    } catch (e) { toast.error((e as Error).message); }
  }

  if (!supported) {
    return <Note kind="info">This browser can't do web push. On iOS, add Claudex to your Home Screen and open it from there.</Note>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Card title="This device">
        <Row ok={on} title={on ? "Notifications are on" : "Notifications are off"}
          desc={on ? "Push is subscribed for this browser" : "Get pinged when Claude finishes or needs you"}>
          {on
            ? <Button size="sm" variant="soft" disabled={busy} onClick={disable} className="h-7 px-2.5 text-xs">Turn off</Button>
            : <Button size="sm" disabled={busy} onClick={enable} className="h-7 px-2.5 text-xs">Enable</Button>}
        </Row>
      </Card>

      {on && cfg && (
        <Card title="Notify me">
          <Toggle label="When Claude finishes a turn" on={cfg.onFinish} onChange={(v) => setCfgKey("onFinish", v)} />
          <Toggle label="When Claude needs my input" on={cfg.onInput} onChange={(v) => setCfgKey("onInput", v)} />
          <Toggle label="Stay quiet for the project I'm viewing" desc="Suppress pings for whatever is on screen"
            on={cfg.muteWhenViewing} onChange={(v) => setCfgKey("muteWhenViewing", v)} />
        </Card>
      )}

      {on && (
        <Card title="Delivery">
          <Row ok={!!s?.hooks} title="Claude hooks" desc={s?.hooks ? "Installed - Claude reports turn events" : "Not installed - no events will fire"}>
            {!s?.hooks && <Button size="sm" onClick={installHooks} className="h-7 px-2.5 text-xs shrink-0">Install</Button>}
          </Row>
          <Row title="Send a test" desc="Fires a push to every subscribed device">
            <Button size="sm" variant="soft" onClick={test} className="h-7 px-2.5 text-xs shrink-0">Send</Button>
          </Row>
        </Card>
      )}
    </div>
  );
}

// ── about ─────────────────────────────────────────────────────────────────────

function AboutPane({ s }: Ctx) {
  return (
    <div className="flex flex-col gap-3">
      <Card title="Client">
        <Row title="Build" desc={__APP_BUILD__} mono />
      </Card>
      <Card title="Server">
        <Row title="Claude Code CLI" desc={s?.claude || "Not detected"} mono />
        <Row title="Node" desc={s?.node || "…"} mono />
        <Row title="Platform" desc={s?.platform || "…"} mono />
        {s?.host && <Row title="Listening on" desc={`${s.host}:${s.port}`} mono />}
      </Card>
      <Note kind="info">
        The build id confirms which client bundle the service worker actually loaded. If it looks
        stale after a deploy, hard-refresh.
      </Note>
    </div>
  );
}
