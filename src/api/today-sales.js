// Server-side Gatsby Function: GET /api/today-sales
// Pulls today's orders (Order Date >= today, same as the Rithum
// "Today's Sales" view) for Amazon UK, eBay UK and Temu UK from the
// ChannelAdvisor REST API. Credentials stay on the server.

const TOKEN_URL = "https://api.channeladvisor.com/oauth2/token";
const ORDERS_URL = "https://api.channeladvisor.com/v1/Orders";

const CHANNELS = [
  { key: "amazon_uk", label: "Amazon UK", siteName: "Amazon UK" },
  { key: "ebay_uk", label: "eBay UK", siteName: "eBay Fixed Price UK" },
  { key: "temu_uk", label: "Temu UK", siteName: "Temu UK" },
];

// Midnight today in Europe/London, expressed as a UTC ISO string (handles BST).
function londonMidnightUtc(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  const guess = new Date(Date.UTC(y, m - 1, d));
  const londonHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hour12: false,
    }).format(guess),
  );
  // London is UTC+1 in BST, so local midnight is 23:00 UTC the previous day.
  guess.setUTCHours(guess.getUTCHours() - londonHour);
  return guess.toISOString().replace(".000Z", "Z");
}

async function getAccessToken() {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.GATSBY_CA_UK_APPLICATION_ID,
      client_secret: process.env.GATSBY_CA_UK_SHARED_SECRET,
      refresh_token: process.env.GATSBY_CA_UK_REFRESH_TOKEN,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `CA auth failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
  }
  return (await response.json()).access_token;
}

async function fetchAllOrders(token, filter, pageSize = 100) {
  const orders = [];
  let skip = 0;
  for (;;) {
    const url = new URL(ORDERS_URL);
    url.search = new URLSearchParams({
      $filter: filter,
      $top: String(pageSize),
      $skip: String(skip),
      profileid: process.env.GATSBY_CA_UK_PROFILE_ID,
    }).toString();
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(
        `CA orders request failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
      );
    }
    const page = (await response.json()).value || [];
    orders.push(...page);
    skip += page.length;
    if (page.length < pageSize) break;
  }
  return orders;
}

export default async function handler(req, res) {
  // Static process.env.X references so Gatsby's function bundler can inline them.
  const creds = {
    CA_UK_APPLICATION_ID: process.env.GATSBY_CA_UK_APPLICATION_ID,
    CA_UK_SHARED_SECRET: process.env.GATSBY_CA_UK_SHARED_SECRET,
    CA_UK_REFRESH_TOKEN: process.env.GATSBY_CA_UK_REFRESH_TOKEN,
    CA_UK_PROFILE_ID: process.env.GATSBY_CA_UK_PROFILE_ID,
  };
  const missing = Object.keys(creds).filter((name) => !creds[name]);
  if (missing.length) {
    return res
      .status(500)
      .json({ error: `Missing environment variables: ${missing.join(", ")}` });
  }

  try {
    const since = londonMidnightUtc();
    const token = await getAccessToken();

    const channels = await Promise.all(
      CHANNELS.map(async (channel) => {
        const filter =
          `SiteName eq '${channel.siteName}'` +
          ` and CheckoutDateUtc ge ${since}`;
        const orders = await fetchAllOrders(token, filter);
        const revenue = orders.reduce(
          (sum, o) => sum + Number(o.TotalPrice || 0),
          0,
        );
        return {
          key: channel.key,
          label: channel.label,
          orderCount: orders.length,
          revenue: Math.round(revenue * 100) / 100,
          orders: orders.map((o) => ({
            siteOrderId: o.SiteOrderID,
            orderDate: o.CheckoutDateUtc,
            total: o.TotalPrice,
            shippingStatus: o.ShippingStatus,
            paymentStatus: o.PaymentStatus,
          })),
        };
      }),
    );

    res.status(200).json({ since, currency: "GBP", channels });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
}
