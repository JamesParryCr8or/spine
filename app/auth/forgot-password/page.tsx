import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { AuthRecoveryShell } from "@/components/auth-recovery-shell";
import { safeAuthRedirect } from "@/lib/auth/redirect";

export const instant = false;

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <AuthRecoveryShell><ForgotPasswordForm next={safeAuthRedirect(typeof next === "string" ? next : null)} /></AuthRecoveryShell>;
}
