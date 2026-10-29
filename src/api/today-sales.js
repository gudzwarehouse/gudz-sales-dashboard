// Server-side Gatsby Function: GET /api/today-sales
// Pulls today's orders (Order Date >= today, same as the Rithum
// "Today's Sales" view) for Amazon UK, eBay UK, Temu UK and Amazon Ireland from the
// ChannelAdvisor REST API. Credentials stay on the server.

const TOKEN_URL = "https://api.channeladvisor.com/oauth2/token";
const ORDERS_URL = "https://api.channeladvisor.com/v1/Orders";

const CHANNELS = [
  {
    key: "amazon_uk",
    label: "Amazon UK",
    siteName: "Amazon UK",
    account: "UK",
    currency: "GBP",
  },
  {
    key: "ebay_uk",
    label: "eBay UK",
    siteName: "eBay Fixed Price UK",
    account: "UK",
    currency: "GBP",
  },
  {
    key: "temu_uk",
    label: "Temu UK",
    siteName: "Temu UK",
    account: "UK",
    currency: "GBP",
  },
  {
    key: "amazon_ie",
    label: "Amazon Ireland",
    siteName: "Amazon Seller Central - IE",
    account: "IRE",
    currency: "EUR",
  },
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

async function getAccessToken(creds) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: creds.applicationId,
      client_secret: creds.sharedSecret,
      refresh_token: creds.refreshToken,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `CA auth failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
  }
  return (await response.json()).access_token;
}

async function fetchAllOrders(token, profileId, filter, pageSize = 100) {
  const orders = [];
  let skip = 0;
  for (;;) {
    const url = new URL(ORDERS_URL);
    url.search = new URLSearchParams({
      $filter: filter,
      $top: String(pageSize),
      $skip: String(skip),
      profileid: profileId,
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
  const accounts = {
    UK: {
      applicationId: process.env.GATSBY_CA_UK_APPLICATION_ID,
      sharedSecret: process.env.GATSBY_CA_UK_SHARED_SECRET,
      refreshToken: process.env.GATSBY_CA_UK_REFRESH_TOKEN,
      profileId: process.env.GATSBY_CA_UK_PROFILE_ID,
    },
    IRE: {
      applicationId: process.env.GATSBY_CA_IRE_APPLICATION_ID,
      sharedSecret: process.env.GATSBY_CA_IRE_SHARED_SECRET,
      refreshToken: process.env.GATSBY_CA_IRE_REFRESH_TOKEN,
      profileId: process.env.GATSBY_CA_IRE_PROFILE_ID,
    },
  };
  const envNames = {
    applicationId: "APPLICATION_ID",
    sharedSecret: "SHARED_SECRET",
    refreshToken: "REFRESH_TOKEN",
    profileId: "PROFILE_ID",
  };
  const missing = Object.entries(accounts).flatMap(([account, creds]) =>
    Object.keys(creds)
      .filter((field) => !creds[field])
      .map((field) => `GATSBY_CA_${account}_${envNames[field]}`),
  );
  if (missing.length) {
    return res
      .status(500)
      .json({ error: `Missing environment variables: ${missing.join(", ")}` });
  }

  try {
    const since = londonMidnightUtc();
    const tokens = {};
    await Promise.all(
      Object.entries(accounts).map(async ([account, creds]) => {
        tokens[account] = await getAccessToken(creds);
      }),
    );

    const channels = await Promise.all(
      CHANNELS.map(async (channel) => {
        const filter =
          `SiteName eq '${channel.siteName}'` +
          ` and CheckoutDateUtc ge ${since}`;
        const orders = await fetchAllOrders(
          tokens[channel.account],
          accounts[channel.account].profileId,
          filter,
        );
        const revenue = orders.reduce(
          (sum, o) => sum + Number(o.TotalPrice || 0),
          0,
        );
        return {
          key: channel.key,
          label: channel.label,
          currency: channel.currency,
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

    res.status(200).json({ since, channels });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
}
