import { UpdatePasswordForm } from "@/components/update-password-form";
import { AuthRecoveryShell } from "@/components/auth-recovery-shell";
import { safeAuthRedirect } from "@/lib/auth/redirect";

export const instant = false;

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <AuthRecoveryShell><UpdatePasswordForm next={safeAuthRedirect(typeof next === "string" ? next : null)} /></AuthRecoveryShell>;
}
