"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm({ next = "/protected" }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const sendReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const updatePasswordPath = `/auth/update-password?next=${encodeURIComponent(next)}`;
      const redirectTo = `${window.location.origin}/auth/confirm?next=${encodeURIComponent(updatePasswordPath)}`;
      const { error: authError } = await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (authError) throw authError;
      setSent(true);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not send the reset link. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="auth-form">
    <div className="auth-form-heading">
      <span className="auth-welcome">ACCOUNT RECOVERY</span>
      <h2>{sent ? "Check your inbox" : "Forgot your password?"}</h2>
      <p>{sent ? <>If <strong>{email}</strong> has a Spine account, we’ve sent a password reset link. Open it to choose a new password.</> : "Enter your account email and we’ll send a secure link to reset your password."}</p>
    </div>
    {!sent && <form onSubmit={(event) => void sendReset(event)} className="auth-fields">
      <div className="auth-field"><label htmlFor="recovery-email">Email address</label><div className="auth-input-wrap"><Mail aria-hidden="true"/><input id="recovery-email" type="email" autoComplete="email" placeholder="you@company.com" required value={email} onChange={(event) => setEmail(event.target.value)} /></div></div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button type="submit" className="auth-submit" disabled={busy}><span>{busy ? "Sending…" : "Send reset link"}</span><ArrowRight aria-hidden="true"/></button>
    </form>}
    <div className="auth-signup"><Link href={`/auth/login?next=${encodeURIComponent(next)}`}>Back to sign in</Link></div>
  </div>;
}
