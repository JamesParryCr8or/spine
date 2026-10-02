"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function UpdatePasswordForm({ next = "/protected" }: { next?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void createClient().auth.getUser().then(({ data: { user } }) => {
      if (active) setStatus(user ? "ready" : "invalid");
    }).catch(() => { if (active) setStatus("invalid"); });
    return () => { active = false; };
  }, []);

  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 8) { setError("Use at least eight characters for your new password."); return; }
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    setBusy(true);
    setError("");
    try {
      const { error: authError } = await createClient().auth.updateUser({ password });
      if (authError) throw authError;
      router.replace(next);
      router.refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not update your password. Please request a new link.");
      setBusy(false);
    }
  };

  return <div className="auth-form">
    <div className="auth-form-heading">
      <span className="auth-welcome">ACCOUNT RECOVERY</span>
      <h2>Choose a new password</h2>
      <p>Set a password you’ll use to sign in to Spine.</p>
    </div>
    {status === "checking" ? <p role="status">Checking your reset link…</p> : status === "invalid" ? <><p className="auth-error" role="alert">This reset link is missing, expired or already used.</p><div className="auth-signup"><Link href={`/auth/forgot-password?next=${encodeURIComponent(next)}`}>Request a new reset link</Link></div></> : <form onSubmit={(event) => void savePassword(event)} className="auth-fields">
      <div className="auth-field"><label htmlFor="new-password">New password</label><div className="auth-input-wrap"><LockKeyhole aria-hidden="true"/><input id="new-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></div></div>
      <div className="auth-field"><label htmlFor="confirm-new-password">Confirm new password</label><div className="auth-input-wrap"><LockKeyhole aria-hidden="true"/><input id="confirm-new-password" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div></div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button type="submit" className="auth-submit" disabled={busy}><span>{busy ? "Saving…" : "Save new password"}</span><ArrowRight aria-hidden="true"/></button>
    </form>}
    <div className="auth-signup"><Link href={`/auth/login?next=${encodeURIComponent(next)}`}>Back to sign in</Link></div>
  </div>;
}
