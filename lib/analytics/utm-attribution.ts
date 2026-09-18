export type AttributionFields = {
  source: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrerUrl: string | null;
};

const sourceAliases: Record<string, string> = {
  fb: "facebook",
  "facebook.com": "facebook",
  ig: "instagram",
  "instagram.com": "instagram",
  googleads: "google",
  "google ads": "google",
};

export function normalizeUtmValue(value: string | null, fallback = "—") {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  return normalized || fallback;
}

export function normalizeUtmSource(value: string | null, fallback = "—") {
  const normalized = normalizeUtmValue(value, fallback);
  return sourceAliases[normalized] ?? normalized;
}

function referrerHost(referrerUrl: string | null) {
  if (!referrerUrl?.trim()) return "";
  try { return new URL(referrerUrl).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return referrerUrl.trim().toLowerCase(); }
}

export function normalizeAttribution(attribution: AttributionFields | null) {
  if (!attribution) return { channel: "Unknown", source: "unknown", medium: "unknown", campaign: "—", content: "—", term: "—" };
  const rawSource = attribution.utmSource ?? attribution.source;
  const source = normalizeUtmSource(rawSource, "");
  const medium = normalizeUtmValue(attribution.utmMedium, "");
  const referrer = referrerHost(attribution.referrerUrl);
  const direct = ["", "direct", "(direct)", "none", "(none)"].includes(source) && !referrer;
  const organic = medium.includes("organic") || ["google", "bing", "yahoo", "duckduckgo"].some((engine) => source === engine && !medium.includes("paid") && medium !== "cpc");
  const referral = medium.includes("referral") || (!source && Boolean(referrer));
  const channel = direct ? "Direct" : organic ? "Organic" : referral ? "Referral" : source || medium ? "Attributed" : "Unknown";
  return {
    channel,
    source: source || (channel === "Direct" ? "direct" : channel === "Referral" ? referrer || "referral" : "unknown"),
    medium: medium || (channel === "Direct" ? "none" : channel === "Organic" ? "organic" : channel === "Referral" ? "referral" : "unknown"),
    campaign: normalizeUtmValue(attribution.utmCampaign),
    content: normalizeUtmValue(attribution.utmContent),
    term: normalizeUtmValue(attribution.utmTerm),
  };
}
