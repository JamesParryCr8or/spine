type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const parseField = (value: unknown, label: string): ValidationResult<string> => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 255) return { ok: false, error: `${label} is required and must be 255 characters or fewer` };
  return { ok: true, value: value.trim() };
};

export function parseCampaignMapping(value: unknown): ValidationResult<{ externalCampaignId: string; utmSource: string; utmMedium: string; utmCampaign: string }> {
  if (!isRecord(value)) return { ok: false, error: "Use a valid campaign mapping" };
  const campaign = parseField(value.externalCampaignId, "Campaign");
  if (!campaign.ok) return campaign;
  const source = parseField(value.utmSource, "UTM source");
  if (!source.ok) return source;
  const medium = parseField(value.utmMedium, "UTM medium");
  if (!medium.ok) return medium;
  const utmCampaign = parseField(value.utmCampaign, "UTM campaign");
  if (!utmCampaign.ok) return utmCampaign;
  return { ok: true, value: { externalCampaignId: campaign.value, utmSource: source.value.toLowerCase(), utmMedium: medium.value.toLowerCase(), utmCampaign: utmCampaign.value.toLowerCase() } };
}

export function parseCampaignMappingId(value: unknown): ValidationResult<{ id: string }> {
  if (typeof value !== "string" || !uuidPattern.test(value)) return { ok: false, error: "A valid campaign-mapping id is required" };
  return { ok: true, value: { id: value } };
}
