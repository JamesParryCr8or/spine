import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

import { AnalyticsApp } from "@/components/analytics-app";

export const instant = false;

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/auth/login");
  // The shell is the layout, so it stays mounted (and keeps its state) while
  // the URL changes between screens. The pages render nothing themselves.
  return <>
    <Suspense fallback={null}><AnalyticsApp /></Suspense>
    {children}
  </>;
}
