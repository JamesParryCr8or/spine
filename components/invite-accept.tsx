"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import "./invite-accept.css";

type InviteState = "checking" | "signed-out" | "sending-code" | "code-sent" | "accepting" | "accepted" | "error";

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
  const [email, setEmail] = useState("");
  const [storeName, setStoreName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

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
    if (!user) { setState("signed-out"); return; }
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

  const sendCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setState("sending-code");
    try {
      const { error: authError } = await createClient().auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (authError) throw authError;
      setState("code-sent");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not send the verification code");
      setState("signed-out");
    }
  };

  const verifyCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setState("accepting");
    try {
      const { error: authError } = await createClient().auth.verifyOtp({ email, token: code.trim(), type: "email" });
      if (authError) throw authError;
      await acceptInvitation();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "That code could not be verified");
      setState("code-sent");
    }
  };

  const switchAccount = async () => {
    await createClient().auth.signOut();
    setError("");
    setState("signed-out");
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
              <h2>{state === "code-sent" ? "Check your inbox" : state === "accepted" ? "You’re in" : "Join your team"}</h2>
              <p>{state === "code-sent" ? <>We sent a secure sign-in code to <strong>{email}</strong>.</> : <>Accept your invitation to <strong>{storeName}</strong>.</>}</p>
            </div>

            {state === "checking" || state === "accepting" || state === "accepted" ? (
              <div className="invite-progress" role="status"><span className="invite-spinner" />{state === "accepted" ? "Opening your workspace…" : state === "accepting" ? "Securing your access…" : "Checking your invitation…"}</div>
            ) : state === "signed-out" || state === "sending-code" ? (
              <form className="invite-code-form" onSubmit={(event) => void sendCode(event)}>
                <label htmlFor="invite-email">Invited email</label>
                <div className="invite-email-field"><Mail aria-hidden="true"/><input id="invite-email" type="email" autoComplete="email" value={email} readOnly /></div>
                <p className="invite-form-hint">We’ll email you a one-time code to securely confirm this address.</p>
                {error && <p className="auth-error" role="alert">{error}</p>}
                <button className="auth-submit" disabled={state === "sending-code"} type="submit"><span>{state === "sending-code" ? "Sending your code…" : "Email me a sign-in code"}</span><ArrowRight /></button>
              </form>
            ) : state === "code-sent" ? (
              <form className="invite-code-form" onSubmit={(event) => void verifyCode(event)}>
                <label htmlFor="invite-code">Six-digit email code</label>
                <input className="invite-code-input" id="invite-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required />
                {error && <p className="auth-error" role="alert">{error}</p>}
                <button className="auth-submit" disabled={code.length !== 6} type="submit"><span>Verify and join store</span><ArrowRight /></button>
                <button className="invite-resend" type="button" onClick={() => { setCode(""); setState("signed-out"); }}>Send a new code</button>
              </form>
            ) : (
              <div className="invite-error-state">
                <p className="auth-error" role="alert">{error}</p>
                <p>Invitation links expire after seven days and can only be used by the invited email address.</p>
                <button className="auth-submit" onClick={() => window.location.reload()}><span>Try again</span><ArrowRight /></button>
                <button className="invite-resend" type="button" onClick={() => void switchAccount()}>Switch account</button>
              </div>
            )}
            <div className="invite-security"><ShieldCheck aria-hidden="true"/><span>Secure sign-in for the invited email address</span></div>
            <Link className="invite-back-link" href="/auth/login">Back to sign in</Link>
          </div>
          <p className="auth-legal">Your invitation grants access only to {storeName} with the role selected by its administrator.</p>
        </section>
      </main>
    </div>
  );
}
