import { NextResponse } from "next/server";

import { requireWorkspace } from "@/lib/workspace/server";

/**
 * Allows one in-flight run of `job` per store; extra requests get 429 with
 * Retry-After. The lock is held in Postgres (try_acquire_job_lock) and
 * expires after `ttlSeconds` — match it to the route's maxDuration so a
 * function that dies mid-job frees the store on its own.
 *
 *   export const POST = withStoreJobLock("shopify_fees", maxDuration, handlePost);
 *
 * The wrapped handler still resolves its own workspace and enforces roles.
 */
export function withStoreJobLock(job: string, ttlSeconds: number, handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    const workspace = await requireWorkspace();
    if (!workspace.ok) return workspace.response;
    if (!workspace.store) return handler(request);
    const storeId = workspace.store.id;

    const { data, error } = await workspace.supabase.rpc("try_acquire_job_lock", { requested_store_id: storeId, job_name: job, ttl_seconds: ttlSeconds });
    if (error) {
      // PGRST202: the function doesn't exist yet (20261009130000_store_job_locks.sql not applied). Run unlocked rather than fail.
      if (error.code === "PGRST202") return handler(request);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const retryAfter = Number(data);
    if (retryAfter > 0) {
      return NextResponse.json(
        { error: "This is already running for this store. Try again when it finishes." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
    try {
      return await handler(request);
    } finally {
      await workspace.supabase.rpc("release_job_lock", { requested_store_id: storeId, job_name: job });
    }
  };
}
