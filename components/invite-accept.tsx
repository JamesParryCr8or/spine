"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, LockKeyhole, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import "./invite-accept.css";

type InviteState = "checking" | "ready" | "working" | "email-sent" | "accepting" | "accepted" | "error";
type InviteMode = "create" | "sign-in";

async function readInviteResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    // Do not surface an HTML proxy/error page as a confusing JSON parse error.
    await response.text();
    throw new Error("We couldn’t reach the invitation service. Please try again in a moment.");
  }
  return response.json() as Promise<{ email?: string; storeName?: string; error?: string }>;
}

export function InviteAccept({ token }: { token: string }) {
  const router = useRouter();
  const attempted = useRef(false);
  const [state, setState] = useState<InviteState>("checking");
  const [mode, setMode] = useState<InviteMode>("create");
  const [email, setEmail] = useState("");
  const [storeName, setStoreName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const callbackUrl = () => `${window.location.origin}/auth/confirm?next=${encodeURIComponent(`/invite/${token}`)}`;

  const acceptInvitation = useCallback(async () => {
    setState("accepting");
    const response = await fetch("/api/team/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = await readInviteResponse(response);
    if (!response.ok) throw new Error(payload.error || "Could not accept invitation");
    setState("accepted");
    router.replace("/protected");
    router.refresh();
  }, [router, token]);

  const checkInvitation = useCallback(async () => {
    setState("checking");
    setError("");
    const previewResponse = await fetch(`/api/team/accept?token=${encodeURIComponent(token)}`, { cache: "no-store" });
    const preview = await readInviteResponse(previewResponse);
    if (!previewResponse.ok || !preview.email) throw new Error(preview.error || "This invitation is invalid or expired");
    setEmail(preview.email);
    setStoreName(preview.storeName || "your store");

    const { data: { user } } = await createClient().auth.getUser();
    if (!user) { setState("ready"); return; }
    await acceptInvitation();
  }, [acceptInvitation, token]);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void checkInvitation().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not open this invitation");
      setState("error");
    });
  }, [checkInvitation]);

  const createAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 8) { setError("Use at least eight characters for your password."); return; }
    if (password !== confirmPassword) { setError("The passwords do not match."); return; }
    setError("");
    setState("working");
    try {
      const { data, error: authError } = await createClient().auth.signUp({
        email, password, options: { emailRedirectTo: callbackUrl() },
      });
      if (authError) throw authError;
      if (data.user?.identities?.length === 0) {
        setMode("sign-in");
        setState("ready");
        setError("This email already has a Spine account. Sign in to join the store.");
        return;
      }
      if (data.session) await acceptInvitation();
      else setState("email-sent");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not create your account");
      setState("ready");
    }
  };

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setState("working");
    try {
      const { error: authError } = await createClient().auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      await acceptInvitation();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not sign in");
      setState("ready");
    }
  };

  const sendEmailLink = async () => {
    setError("");
    setState("working");
    try {
      const { error: authError } = await createClient().auth.signInWithOtp({
        email, options: { shouldCreateUser: false, emailRedirectTo: callbackUrl() },
      });
      if (authError) throw authError;
      setState("email-sent");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not send a sign-in link");
      setState("ready");
    }
  };

  const switchAccount = async () => {
    await createClient().auth.signOut();
    setError("");
    setState("ready");
    router.refresh();
  };

  return (
    <div className="auth-page invite-auth-page">
      <div className="auth-orb auth-orb-one" />
      <div className="auth-orb auth-orb-two" />
      <main className="auth-shell">
        <aside className="auth-story invite-story">
          <div className="auth-brand"><span><Image src="/spine-logo.png" alt="" width={36} height={36} priority /></span><b>Spine</b></div>
          <div className="auth-story-copy">
            <div className="auth-kicker"><Sparkles /> A secure store invitation</div>
            <h1>Great work is built <em>together.</em></h1>
            <p>Join your team in Spine and get a clear view of the numbers, decisions and momentum that move the business forward.</p>
            <ul>
              <li><span><Check /></span>One secure invitation, tied to your email</li>
              <li><span><Check /></span>Access limited to the invited store</li>
              <li><span><Check /></span>Your team’s data stays protected</li>
            </ul>
          </div>
          <small className="auth-story-foot">Spine · The backbone of your business</small>
        </aside>
        <section className="auth-form-side invite-form-side">
          <div className="auth-mobile-brand"><span><Image src="/spine-logo.png" alt="" width={36} height={36} priority /></span><b>Spine</b></div>
          <div className="auth-form invite-form">
            <div className="auth-form-heading">
              <span className="auth-welcome">SPINE STORE INVITATION</span>
              <h2>{state === "email-sent" ? "Check your inbox" : state === "accepted" ? "You’re in" : mode === "create" ? "Create your account" : "Sign in to join"}</h2>
              <p>{state === "email-sent" ? <>Open the confirmation or sign-in link sent to <strong>{email}</strong>, then we’ll take you back here to join <strong>{storeName}</strong>.</> : <>Accept your invitation to <strong>{storeName}</strong>.</>}</p>
            </div>

            {state === "checking" || state === "accepting" || state === "accepted" ? (
              <div className="invite-progress" role="status"><span className="invite-spinner" />{state === "accepted" ? "Opening your workspace…" : state === "accepting" ? "Securing your access…" : "Checking your invitation…"}</div>
            ) : state === "email-sent" ? (
              <div className="invite-email-sent" role="status"><Mail aria-hidden="true"/><p>Use the link in your email. It will bring you back to this invitation automatically.</p><button className="invite-resend" type="button" onClick={() => setState("ready")}>Try another sign-in method</button></div>
            ) : state === "error" ? (
              <div className="invite-error-state">
                <p className="auth-error" role="alert">{error}</p>
                <p>Invitation links expire after seven days and can only be used by the invited email address.</p>
                <button className="auth-submit" onClick={() => window.location.reload()}><span>Try again</span><ArrowRight /></button>
                <button className="invite-resend" type="button" onClick={() => void switchAccount()}>Switch account</button>
              </div>
            ) : (
              <form className="invite-code-form" onSubmit={(event) => void (mode === "create" ? createAccount(event) : signIn(event))}>
                <label htmlFor="invite-email">Invited email</label>
                <div className="invite-email-field"><Mail aria-hidden="true"/><input id="invite-email" type="email" autoComplete="email" value={email} readOnly /></div>
                <label htmlFor="invite-password">{mode === "create" ? "Create password" : "Password"}</label>
                <div className="invite-email-field"><LockKeyhole aria-hidden="true"/><input id="invite-password" type="password" autoComplete={mode === "create" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={mode === "create" ? 8 : undefined} required /></div>
                {mode === "create" && <><label htmlFor="invite-confirm-password">Confirm password</label><div className="invite-email-field"><LockKeyhole aria-hidden="true"/><input id="invite-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div><p className="invite-form-hint">We’ll send a confirmation link to your invited email before opening the store.</p></>}
                {error && <p className="auth-error" role="alert">{error}</p>}
                <button className="auth-submit" disabled={state === "working"} type="submit"><span>{state === "working" ? "Please wait…" : mode === "create" ? "Create account and join" : "Sign in and join"}</span><ArrowRight /></button>
                {mode === "sign-in" && <><button className="invite-resend" disabled={state === "working"} type="button" onClick={() => void sendEmailLink()}>Email me a sign-in link instead</button><Link className="invite-back-link" href={`/auth/forgot-password?next=${encodeURIComponent(`/invite/${token}`)}`}>Forgot password?</Link></>}
                <button className="invite-resend" disabled={state === "working"} type="button" onClick={() => { setMode(mode === "create" ? "sign-in" : "create"); setPassword(""); setConfirmPassword(""); setError(""); }}>{mode === "create" ? "Already have an account? Sign in" : "New to Spine? Create an account"}</button>
              </form>
            )}
            <div className="invite-security"><ShieldCheck aria-hidden="true"/><span>Secure sign-in for the invited email address</span></div>
            <Link className="invite-back-link" href={`/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Back to sign in</Link>
          </div>
          <p className="auth-legal">Your invitation grants access only to {storeName} with the role selected by its administrator.</p>
        </section>
      </main>
    </div>
  );
}
