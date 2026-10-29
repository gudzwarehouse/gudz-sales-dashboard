import { requestJson } from "./http";
import { fetchPaged } from "./pagination";

const TOKEN_URL = "https://api.channeladvisor.com/oauth2/token";
const ORDERS_URL = "https://api.channeladvisor.com/v1/Orders";
const PAGE_SIZE = 100;
const DEFAULT_TOKEN_LIFETIME_S = 3600;
const TOKEN_EXPIRY_MARGIN_S = 60;

const tokenCache = new Map();

async function getAccessToken(creds, { force = false } = {}) {
  const cacheKey = `${creds.applicationId}|${creds.profileId}`;
  const cached = tokenCache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.token;

  const body = await requestJson(
    TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: creds.applicationId,
        client_secret: creds.sharedSecret,
        refresh_token: creds.refreshToken,
      }),
    },
    "ChannelAdvisor auth",
  );
  if (!body?.access_token) {
    throw new Error("ChannelAdvisor auth response had no access_token");
  }
  const lifetime = Math.max(
    TOKEN_EXPIRY_MARGIN_S,
    (Number(body.expires_in) || DEFAULT_TOKEN_LIFETIME_S) - TOKEN_EXPIRY_MARGIN_S,
  );
  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + lifetime * 1000,
  });
  return body.access_token;
}

function ordersUrl(creds, filter, skip) {
  const url = new URL(ORDERS_URL);
  const params = {
    $filter: filter,
    $select: "SiteName,TotalPrice,CheckoutDateUtc",
    $top: String(PAGE_SIZE),
    $skip: String(skip),
    profileid: creds.profileId,
  };
  // $count slows a request down, so only the first page asks for it.
  if (skip === 0) params.$count = "true";
  url.search = new URLSearchParams(params).toString();
  return url;
}

export async function fetchChannelAdvisorOrders(creds, filter) {
  let token = await getAccessToken(creds);

  return fetchPaged(async (skip) => {
    const call = () =>
      requestJson(
        ordersUrl(creds, filter, skip),
        { headers: { Authorization: `Bearer ${token}` } },
        "ChannelAdvisor orders request",
      );

    let body;
    try {
      body = await call();
    } catch (error) {
      if (error.status !== 401) throw error;
      token = await getAccessToken(creds, { force: true });
      body = await call();
    }
    if (!Array.isArray(body?.value)) {
      throw new Error("ChannelAdvisor orders response had no 'value' list");
    }
    return { items: body.value, total: Number(body["@odata.count"]) };
  }, PAGE_SIZE);
}
