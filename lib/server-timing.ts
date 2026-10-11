/**
 * Wraps a route handler to log how long it took and expose the same figure in
 * a Server-Timing header (visible in browser dev tools). The log line is one
 * JSON object, so it can be filtered in Vercel's runtime logs for slow routes.
 */
export function timed<Args extends unknown[]>(route: string, handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    const start = performance.now();
    const response = await handler(...args);
    const ms = Math.round(performance.now() - start);
    try { response.headers.set("Server-Timing", `total;dur=${ms}`); } catch { /* immutable response: the log line is enough */ }
    console.info(JSON.stringify({ event: "route_timing", route, ms, status: response.status }));
    return response;
  };
}
