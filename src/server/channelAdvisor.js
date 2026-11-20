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
    (Number(body.expires_in) || DEFAULT_TOKEN_LIFETIME_S) -
      TOKEN_EXPIRY_MARGIN_S,
  );
  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + lifetime * 1000,
  });
  return body.access_token;
}

const ORDER_FIELDS =
  "ID,SiteName,SiteAccountID,TotalPrice,CheckoutDateUtc,DistributionCenterTypeRollup,OrderTags,RequestedShippingClass";

function ordersUrl(creds, filter, skip, withItems) {
  const url = new URL(ORDERS_URL);
  const params = {
    $filter: filter,
    $select: ORDER_FIELDS,
    $top: String(PAGE_SIZE),
    $skip: String(skip),
    profileid: creds.profileId,
  };
  if (withItems) params.$expand = "Items($select=Sku,Title,Quantity,UnitPrice)";
  // $count slows a request down, so only the first page asks for it.
  if (skip === 0) params.$count = "true";
  url.search = new URLSearchParams(params).toString();
  return url;
}

export async function fetchChannelAdvisorOrders(
  creds,
  filter,
  { withItems = false } = {},
) {
  let token = await getAccessToken(creds);

  return fetchPaged(async (skip) => {
    const call = () =>
      requestJson(
        ordersUrl(creds, filter, skip, withItems),
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

const PRODUCTS_URL = "https://api.channeladvisor.com/v1/Products";
const PRODUCT_BATCH = 20;
const PRODUCT_CONCURRENCY = 4;

// Only these catalogue attributes are fetched; a product carries dozens more
// (descriptions, prices) that would make the response huge.
const UNIT_COUNT = "Unit Count";
const OUR_SKU = "Our SKU";
const ATTRIBUTES_EXPAND = `Attributes($filter=Name eq '${UNIT_COUNT}' or Name eq '${OUR_SKU}';$select=Name,Value)`;

async function fetchProductBatch(creds, skus, token) {
  const filter = skus
    .map((sku) => `Sku eq '${sku.replace(/'/g, "''")}'`)
    .join(" or ");
  const url = new URL(PRODUCTS_URL);
  url.search = new URLSearchParams({
    $filter: filter,
    $select: "Sku,Manufacturer,SupplierName",
    $expand: ATTRIBUTES_EXPAND,
    $top: String(PRODUCT_BATCH * 2),
    profileid: creds.profileId,
  }).toString();
  const body = await requestJson(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    "ChannelAdvisor products request",
  );
  if (!Array.isArray(body?.value)) {
    throw new Error("ChannelAdvisor products response had no 'value' list");
  }
  return body.value;
}

const attribute = (product, name) =>
  String(
    (product.Attributes || []).find((a) => a.Name === name)?.Value ?? "",
  ).trim();

// Returns a Map of lower-cased sku -> { manufacturer, supplier, ourSku,
// unitCount } for the SKUs that exist in the account's catalogue. Unset text
// is an empty string; `unitCount` (the pack size) is 1 when unset.
export async function fetchChannelAdvisorCatalogue(creds, skus) {
  let token = await getAccessToken(creds);
  const batches = [];
  for (let i = 0; i < skus.length; i += PRODUCT_BATCH) {
    batches.push(skus.slice(i, i + PRODUCT_BATCH));
  }
  const found = new Map();
  const load = async (batch) => {
    let products;
    try {
      products = await fetchProductBatch(creds, batch, token);
    } catch (error) {
      if (error.status !== 401) throw error;
      token = await getAccessToken(creds, { force: true });
      products = await fetchProductBatch(creds, batch, token);
    }
    for (const product of products) {
      const unitCount = Number(attribute(product, UNIT_COUNT));
      found.set(String(product.Sku).toLowerCase(), {
        manufacturer: String(product.Manufacturer || "").trim(),
        supplier: String(product.SupplierName || "").trim(),
        ourSku: attribute(product, OUR_SKU),
        unitCount: unitCount >= 1 ? unitCount : 1,
      });
    }
  };
  for (let i = 0; i < batches.length; i += PRODUCT_CONCURRENCY) {
    await Promise.all(batches.slice(i, i + PRODUCT_CONCURRENCY).map(load));
  }
  return found;
}
