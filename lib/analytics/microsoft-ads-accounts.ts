type MicrosoftAdsAccount = {
  Id?: string | number;
  Name?: string;
  Number?: string;
  CurrencyCode?: string;
  AccountLifeCycleStatus?: string;
};

type MicrosoftAdsCustomerRole = { CustomerId?: string | number };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asItems<T>(value: unknown, nestedKey: string): T[] {
  if (Array.isArray(value)) return value as T[];
  const nested = asRecord(value)?.[nestedKey];
  if (Array.isArray(nested)) return nested as T[];
  return nested ? [nested as T] : [];
}

export function microsoftAdsCustomerIds(payload: unknown): string[] {
  const response = asRecord(payload);
  const user = asRecord(response?.User);
  const roles = response?.CustomerRoles ?? user?.CustomerRoles;
  return [...new Set(asItems<MicrosoftAdsCustomerRole>(roles, "CustomerRole")
    .map((role) => String(role.CustomerId ?? ""))
    .filter(Boolean))];
}

export function microsoftAdsAccounts(payload: unknown, customerId: string) {
  const raw = asRecord(payload)?.AccountsInfo;
  return asItems<MicrosoftAdsAccount>(raw, "AccountInfo")
    .filter((account) => account.Id != null)
    .map((account) => ({
      account_id: String(account.Id),
      customer_id: customerId,
      name: account.Name || `Microsoft Advertising account ${account.Id}`,
      account_number: account.Number ?? null,
      currency: account.CurrencyCode ?? null,
      status: account.AccountLifeCycleStatus ?? null,
    }));
}
