import { useState } from "react";
import { m as motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { login } from "@/lib/api";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pw.trim()) return;
    setBusy(true); setErr(null);
    try { await login(pw.trim()); onSuccess(); }
    catch (ex: any) { setErr(ex?.message || "Wrong password, try again."); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 mesh flex items-center justify-center p-6">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="w-[min(380px,100%)] rounded-2xl border border-border bg-panel p-7"
      >
        <div className="flex items-center gap-3 mb-6">
          <img src="/icon.svg" alt="" className="w-10 h-10 rounded-lg" />
          <div>
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em]">Claudex</h1>
            <p className="text-[14px] text-muted">Enter your password</p>
          </div>
        </div>
        <Input
          autoFocus type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          placeholder="Password" autoComplete="current-password"
          className={err ? "border-danger focus:border-danger" : ""}
        />
        {err && <p className="text-xs text-danger mt-2">{err}</p>}
        <Button type="submit" disabled={busy} className="w-full mt-4">
          {busy ? "Checking…" : "Enter"} <ArrowRight size={16} />
        </Button>
      </motion.form>
    </div>
  );
}
