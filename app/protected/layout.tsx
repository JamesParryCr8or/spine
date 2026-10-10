import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

import { AnalyticsApp } from "@/components/analytics-app";
import { QueryCacheScope } from "@/components/query-cache-scope";
import { requireWorkspace } from "@/lib/workspace/server";

export const instant = false;

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/auth/login");
  // The cached responses on this device are scoped to this user and store.
  const workspace = await requireWorkspace();
  const storeId = workspace.ok ? workspace.store?.id ?? null : null;
  // The shell is the layout, so it stays mounted (and keeps its state) while
  // the URL changes between screens. The pages render nothing themselves.
  return <>
    <QueryCacheScope userId={data.claims.sub} storeId={storeId} />
    <Suspense fallback={null}><AnalyticsApp /></Suspense>
    {children}
  </>;
}
