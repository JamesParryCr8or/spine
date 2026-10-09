import { useState } from "react";

/**
 * Runs `reset` during render whenever `key` changes: React's "adjusting state
 * when a prop changes" pattern. Use it for the loading/error resets a fetch
 * effect would otherwise make synchronously at the top of its body
 * (react-hooks/set-state-in-effect), so the reset lands in the same render
 * as the change instead of a cascading one. A null key does nothing and
 * keeps the last key, for inputs that are mid-edit and won't fetch yet.
 */
export function useResetOnChange(key: string | null, reset: () => void) {
  const [previous, setPrevious] = useState<string | null>(null);
  if (key !== null && key !== previous) {
    setPrevious(key);
    reset();
  }
}
