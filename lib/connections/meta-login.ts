type LoginOptions = { appId: string; redirectUri: string; state: string; configurationId?: string };

export function metaLoginUrl({ appId, redirectUri, state, configurationId }: LoginOptions) {
  const url = new URL("https://www.facebook.com/v22.0/dialog/oauth");
  url.search = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, response_type: "code",
    ...(configurationId ? { config_id: configurationId, override_default_response_type: "true" } : { scope: "ads_read" }),
  }).toString();
  return url;
}

export async function exchangeMetaCode({ appId, appSecret, redirectUri, code, configurationId }: {
  appId: string; appSecret: string; redirectUri: string; code: string; configurationId?: string;
}) {
  const exchange = async (params: URLSearchParams) => {
    const response = await fetch(`https://graph.facebook.com/v22.0/oauth/access_token?${params}`, {
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as { access_token?: string; error?: { message?: string } };
    if (!response.ok || !payload.access_token) throw new Error(payload.error?.message ?? "Meta could not complete sign-in.");
    return payload.access_token;
  };
  const token = await exchange(new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }));
  // Business configurations define their token type and duration. In particular,
  // business integration system-user tokens cannot use the user-token extension.
  if (configurationId) return token;
  return exchange(new URLSearchParams({ grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: token }));
}
