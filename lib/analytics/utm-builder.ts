export type CampaignUrlInput = {
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
};

export type CampaignUrlResult =
  | { ok: true; url: string; values: Required<CampaignUrlInput> }
  | { ok: false; error: string };

export function normalizeUtmValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildCampaignUrl(baseUrl: string, input: CampaignUrlInput): CampaignUrlResult {
  const values = {
    source: normalizeUtmValue(input.source),
    medium: normalizeUtmValue(input.medium),
    campaign: normalizeUtmValue(input.campaign),
    content: normalizeUtmValue(input.content ?? ""),
    term: normalizeUtmValue(input.term ?? ""),
  };
  if (!baseUrl.trim()) return { ok: false, error: "Enter a landing-page URL" };
  if (!values.source || !values.medium || !values.campaign) {
    return { ok: false, error: "Source, medium, and campaign are required" };
  }
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return { ok: false, error: "Enter a complete URL beginning with https://" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Campaign URLs must use http or https" };
  }
  url.searchParams.set("utm_source", values.source);
  url.searchParams.set("utm_medium", values.medium);
  url.searchParams.set("utm_campaign", values.campaign);
  if (values.content) url.searchParams.set("utm_content", values.content);
  else url.searchParams.delete("utm_content");
  if (values.term) url.searchParams.set("utm_term", values.term);
  else url.searchParams.delete("utm_term");
  return { ok: true, url: url.toString(), values };
}
