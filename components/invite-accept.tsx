"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type InviteState = "checking" | "signed-out" | "sending-code" | "code-sent" | "accepting" | "accepted" | "error";

export function InviteAccept({ token }: { token: string }) {
  const router = useRouter();
  const attempted = useRef(false);
  const [state, setState] = useState<InviteState>("checking");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const acceptInvitation = useCallback(async () => {
    setState("accepting");
    const response = await fetch("/api/team/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not accept invitation");
    setState("accepted");
    router.replace("/protected");
    router.refresh();
  }, [router, token]);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    const run = async () => {
      const previewResponse = await fetch(`/api/team/accept?token=${encodeURIComponent(token)}`);
      const preview = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(preview.error || "This invitation is invalid or expired");
      setEmail(preview.email);

      const { data: { user } } = await createClient().auth.getUser();
      if (!user) { setState("signed-out"); return; }
      setState("accepting");
      await acceptInvitation();
    };
    void run().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not open this invitation");
      setState("error");
    });
  }, [acceptInvitation, token]);

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
    <main className="invite-shell">
      <div className="panel invite-card">
        <span className="eyebrow">SPINE WORKSPACE</span>
        <h1>Join your team</h1>
        {state === "checking" || state === "accepting" || state === "accepted" ? (
          <p>{state === "accepted" ? "Invitation accepted. Opening your workspace…" : "Checking your invitation…"}</p>
        ) : state === "signed-out" || state === "sending-code" ? (
          <>
            <p>Confirm your invited email and we’ll send a one-time code. Enter it here to join, even if you opened this link on a different device.</p>
            <form className="invite-code-form" onSubmit={(event) => void sendCode(event)}>
              <label htmlFor="invite-email">Invited email</label>
              <input id="invite-email" type="email" autoComplete="email" value={email} readOnly />
              {error && <p role="alert">{error}</p>}
              <button className="primary" disabled={state === "sending-code"} type="submit">{state === "sending-code" ? "Sending code…" : "Email me a sign-in code"}</button>
            </form>
          </>
        ) : state === "code-sent" ? (
          <>
            <p>Enter the one-time code sent to <strong>{email}</strong>.</p>
            <form className="invite-code-form" onSubmit={(event) => void verifyCode(event)}>
              <label htmlFor="invite-code">Email code</label>
              <input id="invite-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} required />
              {error && <p role="alert">{error}</p>}
              <button className="primary" type="submit">Verify code and join</button>
              <button className="invite-resend" type="button" onClick={() => setState("signed-out")}>Send a new code</button>
            </form>
          </>
        ) : (
          <>
            <p role="alert">{error}</p>
            <p>Make sure you’re using the invited email. Ask your workspace admin for a new link if this one has expired.</p>
            <button className="primary" onClick={() => void switchAccount()}>Switch account</button>
          </>
        )}
      </div>
    </main>
  );
}
