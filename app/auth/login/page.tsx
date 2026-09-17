import { LoginForm } from "@/components/login-form";
import { createClient } from "@/lib/supabase/server";
import { BarChart3, Check, Sparkles, TrendingUp } from "lucide-react";
import { redirect } from "next/navigation";

export const instant = false;

export default async function Page() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/protected");

  return (
    <div className="auth-page">
      <div className="auth-orb auth-orb-one" />
      <div className="auth-orb auth-orb-two" />
      <main className="auth-shell">
        <aside className="auth-story">
          <div className="auth-brand"><span><BarChart3 /></span>Cr8or <b>Data</b></div>
          <div className="auth-story-copy">
            <div className="auth-kicker"><Sparkles /> Ecommerce intelligence, simplified</div>
            <h1>Know what your store <em>really</em> earns.</h1>
            <p>Bring sales, marketing and costs together in one clear view of your profit.</p>
            <ul>
              <li><span><Check /></span>Reconciled Shopify reporting</li>
              <li><span><Check /></span>Product and campaign profitability</li>
              <li><span><Check /></span>Clear, trusted financial metrics</li>
            </ul>
          </div>
          <div className="auth-preview-card">
            <div><span>NET PROFIT</span><strong>£92,917</strong><small><TrendingUp /> 18.2% this period</small></div>
            <div className="auth-mini-chart">{[36,52,44,67,58,78,71,92].map((height,index)=><i key={index} style={{height:`${height}%`}} />)}</div>
          </div>
          <small className="auth-story-foot">Built for profitable ecommerce growth.</small>
        </aside>
        <section className="auth-form-side">
          <div className="auth-mobile-brand"><span><BarChart3 /></span>Cr8or <b>Data</b></div>
          <LoginForm />
          <p className="auth-legal">By continuing, you agree to secure and responsible use of your connected store data.</p>
        </section>
      </main>
    </div>
  );
}
