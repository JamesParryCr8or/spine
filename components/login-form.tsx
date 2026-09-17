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
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      // Update this route to redirect to an authenticated route. The user already has an active session.
      router.push("/protected");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("auth-form", className)} {...props}>
      <div className="auth-form-heading">
        <span className="auth-welcome">WELCOME BACK</span>
        <h2>Sign in to your workspace</h2>
        <p>See the complete picture behind your ecommerce performance.</p>
      </div>
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
          <Button type="submit" className="auth-submit" disabled={isLoading}>
            <span>{isLoading ? "Signing you in…" : "Sign in"}</span>{!isLoading&&<ArrowRight />}
          </Button>
        </div>
        <div className="auth-signup">New to Cr8or Data? <Link href="/auth/sign-up">Create an account</Link></div>
      </form>
    </div>
  );
}
