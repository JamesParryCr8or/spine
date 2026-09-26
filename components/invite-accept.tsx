"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function InviteAccept({ token }: { token: string }) {
  const router = useRouter();
  const attempted = useRef(false);
  const [state, setState] = useState<"checking" | "signed-out" | "accepting" | "accepted" | "error">("checking");
  const [error, setError] = useState("");
  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    const run = async () => {
      const { data: { user } } = await createClient().auth.getUser();
      if (!user) { setState("signed-out"); return; }
      setState("accepting");
      const response = await fetch("/api/team/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const payload = await response.json();
      if (!response.ok) { setError(payload.error || "Could not accept invitation"); setState("error"); return; }
      setState("accepted");
      router.replace("/protected");
      router.refresh();
    };
    void run().catch((reason) => { setError(reason instanceof Error ? reason.message : "Could not accept invitation"); setState("error"); });
  }, [token, router]);
  const next = `/invite/${token}`;
  const switchAccount = async () => { await createClient().auth.signOut(); router.push(`/auth/login?next=${encodeURIComponent(next)}`); router.refresh(); };
  return <main className="invite-shell"><div className="panel invite-card"><span className="eyebrow">SPINE WORKSPACE</span><h1>Join your team</h1>{state === "checking" || state === "accepting" || state === "accepted" ? <p>{state === "accepted" ? "Invitation accepted. Opening your workspace…" : "Checking your invitation…"}</p> : state === "signed-out" ? <><p>Sign in or create an account with the email address that received this invitation.</p><div className="invite-actions"><Link className="primary" href={`/auth/login?next=${encodeURIComponent(next)}`}>Sign in</Link><Link href={`/auth/sign-up?next=${encodeURIComponent(next)}`}>Create account</Link></div></> : <><p role="alert">{error}</p><p>Make sure you are signed in with the invited email. Ask your workspace admin for a new link if this one has expired.</p><button className="primary" onClick={() => void switchAccount()}>Switch account</button></>}</div></main>;
}
