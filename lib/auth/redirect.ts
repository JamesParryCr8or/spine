export function safeAuthRedirect(value: string | null, fallback = "/protected") {
  if (!value || !/^\/(?!\/)[^\r\n]*$/.test(value)) return fallback;
  return value;
}
