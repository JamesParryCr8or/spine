"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authMethod, setAuthMethod] = useState<"password" | "google" | "magic" | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  const nextDestination = () => {
    const candidate = new URLSearchParams(window.location.search).get("next");
    return candidate && /^\/(?!\/)[^\r\n]*$/.test(candidate) ? candidate : "/protected";
  };
  const callbackUrl = () => `${window.location.origin}/auth/confirm?next=${encodeURIComponent(nextDestination())}`;

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setAuthMethod("google");
    setError(null);
    setMagicSent(false);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl() },
      });
      if (error) throw error;
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Google sign-in could not be started.");
      setIsLoading(false);
      setAuthMethod(null);
    }
  };

  const handleMagicLink = async () => {
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    setIsLoading(true);
    setAuthMethod("magic");
    setError(null);
    setMagicSent(false);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: callbackUrl() },
      });
      if (error) throw error;
      setMagicSent(true);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "We could not send a sign-in link.");
    } finally {
      setIsLoading(false);
      setAuthMethod(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setAuthMethod("password");
    setError(null);
    setMagicSent(false);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      // Update this route to redirect to an authenticated route. The user already has an active session.
      router.push(nextDestination());
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "We could not sign you in. Please try again.");
    } finally {
      setIsLoading(false);
      setAuthMethod(null);
    }
  };

  return (
    <div className={cn("auth-form", className)} {...props}>
      <div className="auth-form-heading">
        <span className="auth-welcome">WELCOME BACK</span>
        <h2>Sign in to your workspace</h2>
        <p>See the complete picture behind your ecommerce performance.</p>
      </div>
      <Button type="button" className="auth-google" disabled={isLoading} onClick={() => void handleGoogleLogin()}>
        <span className="auth-google-mark">G</span><span>{isLoading && authMethod === "google" ? "Opening Google…" : "Continue with Google"}</span>
      </Button>
      <div className="auth-divider"><span>or continue with email</span></div>
      <form onSubmit={handleLogin}>
        <div className="auth-fields">
          <div className="auth-field">
            <Label htmlFor="email">Email address</Label>
            <div className="auth-input-wrap">
              <Mail aria-hidden="true" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
            </div>
          </div>
          <div className="auth-field">
            <div className="auth-label-row">
              <Label htmlFor="password">Password</Label>
              <Link href="/auth/forgot-password">Forgot password?</Link>
            </div>
            <div className="auth-input-wrap">
              <LockKeyhole aria-hidden="true" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              <button className="auth-password-toggle" type="button" onClick={()=>setShowPassword(!showPassword)} aria-label={showPassword?"Hide password":"Show password"}>{showPassword?<EyeOff/>:<Eye/>}</button>
            </div>
          </div>
          {error && <p className="auth-error" role="alert">{error}</p>}
          {magicSent && <p className="auth-success" role="status">Check your inbox for a secure sign-in link.</p>}
          <Button type="submit" className="auth-submit" disabled={isLoading}>
            <span>{isLoading && authMethod === "password" ? "Signing you in…" : "Sign in with password"}</span>{!(isLoading && authMethod === "password")&&<ArrowRight />}
          </Button>
          <Button type="button" className="auth-magic" disabled={isLoading} onClick={() => void handleMagicLink()}>
            <Mail aria-hidden="true"/><span>{isLoading && authMethod === "magic" ? "Sending link…" : "Email me a sign-in link"}</span>
          </Button>
        </div>
        <div className="auth-signup">New to Spine? <Link href="/auth/sign-up">Create an account</Link></div>
        <a className="auth-demo-link" href="/api/demo">Explore the demo first <ArrowRight /></a>
      </form>
    </div>
  );
}
