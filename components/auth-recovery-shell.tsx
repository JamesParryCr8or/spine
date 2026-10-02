import Image from "next/image";
import { Check, ShieldCheck, Sparkles } from "lucide-react";

export function AuthRecoveryShell({ children }: { children: React.ReactNode }) {
  return <div className="auth-page">
    <div className="auth-orb auth-orb-one" />
    <div className="auth-orb auth-orb-two" />
    <main className="auth-shell">
      <aside className="auth-story">
        <div className="auth-brand"><span><Image src="/spine-logo.png" alt="" width={36} height={36} priority /></span><b>Spine</b></div>
        <div className="auth-story-copy">
          <div className="auth-kicker"><Sparkles /> Secure account access</div>
          <h1>Get back to <em>the full picture.</em></h1>
          <p>Reset your password securely and pick up where you left off.</p>
          <ul><li><span><Check /></span>One secure link, sent to your email</li><li><span><Check /></span>Your connected store data stays protected</li></ul>
        </div>
        <small className="auth-story-foot">Spine · The backbone of your business</small>
      </aside>
      <section className="auth-form-side">
        <div className="auth-mobile-brand"><span><Image src="/spine-logo.png" alt="" width={36} height={36} priority /></span><b>Spine</b></div>
        {children}
        <p className="auth-legal"><ShieldCheck aria-hidden="true" style={{ width: 13, height: 13, display: "inline", verticalAlign: "middle" }} /> Your account and store data are protected.</p>
      </section>
    </main>
  </div>;
}
