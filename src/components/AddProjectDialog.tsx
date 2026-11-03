import { useEffect, useState, useCallback } from "react";
import { Folder, Home, ArrowUp, Lock, Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { GroupPicker } from "@/components/GroupPicker";
import { api } from "@/lib/api";
import { useStore } from "@/store/store";
import { useUI } from "@/store/ui";
import { cn } from "@/lib/utils";
import type { BrowseResult, GithubRepo, Project } from "@/types";

export function AddProjectDialog() {
  const open = useUI((s) => s.addOpen);
  const close = useUI((s) => s.closeAdd);
  const defaultLaunch = useStore((s) => s.defaultLaunch);

  const [tab, setTab] = useState<"local" | "github">("local");
  const [data, setData] = useState<BrowseResult | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [name, setName] = useState("");
  const [launch, setLaunch] = useState("");
  const [group, setGroup] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [repoQuery, setRepoQuery] = useState("");
  const [selected, setSelected] = useState<GithubRepo | null>(null);

  const browse = useCallback(async (p?: string, hidden = showHidden) => {
    try {
      const q = new URLSearchParams();
      if (p) q.set("path", p);
      if (hidden) q.set("all", "1");
      const d = await api<BrowseResult>("GET", "/api/browse?" + q.toString());
      setData(d); setPathInput(d.path); setName(d.name);
      localStorage.setItem("cx_pk_last", d.path);
    } catch (e) { toast.error((e as Error).message); }
  }, [showHidden]);

  useEffect(() => {
    if (open) {
      setTab("local"); setRepos(null); setSelected(null); setRepoQuery("");
      setLaunch(defaultLaunch); setGroup(""); setMakeDefault(false);
      browse(localStorage.getItem("cx_pk_last") || "");
    }
  }, [open]); // eslint-disable-line

  async function goGithub() {
    setTab("github");
    if (repos === null) {
      try { const d = await api<{ repos: GithubRepo[] }>("GET", "/api/github/repos"); setRepos(d.repos); }
      catch (e) { setRepos([]); toast.error((e as Error).message); }
    }
    const dest = localStorage.getItem("cx_clone_dest") || (data ? data.home.replace(/\/$/, "") + "/GitHubProjects" : "");
    if (dest) browse(dest);
  }

  async function add() {
    const finalName = name.trim() || pathInput.split(/[\\/]/).pop() || "";
    if (!finalName || !pathInput) return;
    setBusy(true);
    try {
      if (makeDefault) { await api("POST", "/api/config", { defaultLaunch: launch }); useStore.setState({ defaultLaunch: launch }); }
      const finalPath = pathInput.trim();
      await api("POST", "/api/projects", { name: finalName, path: finalPath, launch, group });
      await useStore.getState().loadProjects();
      // Remember the parent folder so next open lands beside the added project, not inside it.
      const parent = (data?.path === finalPath && data?.parent)
        ? data.parent
        : finalPath.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, "");
      localStorage.setItem("cx_pk_last", parent || finalPath);
      close();   // the new project is in the sidebar by now - no toast needed to say so
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  async function clone() {
    if (!selected) return;
    setBusy(true);
    try {
      const dest = pathInput.trim();
      await api<Project>("POST", "/api/github/clone", { url: selected.clone_url, dest });
      localStorage.setItem("cx_clone_dest", dest);
      await useStore.getState().loadProjects();
      close();   // same - the clone lands in the sidebar
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  const filtered = repos ? repos.filter((r) => r.name.toLowerCase().includes(repoQuery.toLowerCase())) : [];

  function browserView(height: string) {
    return (
      <>
        <div className="flex gap-1.5 mb-2">
          <IconBtn onClick={() => browse("")}><Home size={16} /></IconBtn>
          <IconBtn disabled={!data?.parent} onClick={() => data?.parent && browse(data.parent)}><ArrowUp size={16} /></IconBtn>
          <Input value={pathInput} onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && browse(pathInput.trim())}
            spellCheck={false} className="font-mono text-[12px] h-9" />
        </div>
        <div className={cn(height, "overflow-y-auto rounded-lg bg-bg p-1")}>
          {data?.entries.length ? data.entries.map((e) => (
            <div key={e.path} onClick={() => browse(e.path)}
              className="flex items-center gap-2.5 px-2.5 h-9 rounded-md cursor-pointer hover:bg-panel2 text-[14px]">
              <Folder size={16} className="text-muted shrink-0" />
              <span className="truncate">{e.name}</span>
            </div>
          )) : <p className="text-[13px] text-muted text-center py-8">No subfolders.</p>}
        </div>
      </>
    );
  }

  return (
    <Modal open={open} onClose={close} title="Add a project" subtitle="Pick a local folder or clone from GitHub" className="w-[min(560px,calc(100vw-24px))]">
      <div className="flex gap-1 mb-3 p-1 bg-bg rounded-lg">
        <TabBtn active={tab === "local"} onClick={() => setTab("local")}>Local folder</TabBtn>
        <TabBtn active={tab === "github"} onClick={goGithub}>From GitHub</TabBtn>
      </div>

      {tab === "local" ? (
        <>
          {browserView("h-56")}
          <div className="grid gap-3 mt-3">
            <Field label="Project name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Launch command" hint="(blank = just a shell)">
              <Input value={launch} onChange={(e) => setLaunch(e.target.value)} placeholder="claude" spellCheck={false} className="font-mono text-[13px]" />
            </Field>
            <GroupPicker value={group} onChange={setGroup} />
            <div className="flex flex-col gap-2.5">
              <Check checked={makeDefault} onChange={setMakeDefault}>Make this my default launch command</Check>
              <Check checked={showHidden} onChange={(v) => { setShowHidden(v); browse(pathInput.trim(), v); }}>Show hidden folders</Check>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-border -mx-5 px-5">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={add} disabled={busy}>Add folder</Button>
          </div>
        </>
      ) : (
        <>
          <Input placeholder="Search your repositories" value={repoQuery} onChange={(e) => setRepoQuery(e.target.value)} className="h-9 mb-2" />
          <div className="h-40 overflow-y-auto rounded-lg bg-bg p-1">
            {repos === null ? (
              <div className="h-full grid place-items-center">
                <span className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={15} className="animate-spin" />Loading repositories…</span>
              </div>
            ) : filtered.length ? filtered.map((r) => (
              <div key={r.full_name} onClick={() => setSelected(r)}
                className={cn("flex items-center gap-2.5 px-2.5 h-9 rounded-md cursor-pointer text-[14px]",
                  selected?.full_name === r.full_name ? "bg-panel2 text-fg font-medium ring-1 ring-inset ring-accent/50" : "hover:bg-panel2")}>
                {r.private ? <Lock size={15} className="text-muted shrink-0" /> : <Globe size={15} className="text-muted shrink-0" />}
                <span className="truncate">{r.name}</span>
              </div>
            )) : <div className="h-full grid place-items-center"><span className="text-[13px] text-muted">No repositories.</span></div>}
          </div>
          <p className="text-[14px] font-medium mt-3 mb-2">Clone into</p>
          {browserView("h-40")}
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-border -mx-5 px-5">
            <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
            <Button onClick={clone} disabled={busy || !selected}>
              {busy ? <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Cloning…</span> : "Clone"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn("flex-1 h-8 rounded-md text-[13px] font-medium transition-colors", active ? "bg-panel2 text-fg" : "text-muted hover:text-fg")}>
      {children}
    </button>
  );
}
function IconBtn({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className="grid place-items-center w-9 h-9 shrink-0 rounded-md bg-panel2 text-muted hover:text-fg hover:bg-border transition-colors disabled:opacity-40">{children}</button>;
}
function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2.5 text-[14px] cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-accent" />
      {children}
    </label>
  );
}
