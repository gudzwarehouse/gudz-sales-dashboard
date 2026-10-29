// Server-side Gatsby Function: GET /api/today-sales
// Sales per channel for a London-time date range (today, yesterday, last 30
// days or a custom range) across Amazon UK, eBay UK, Temu UK, Amazon Ireland
// (ChannelAdvisor) and Tesco, Superdrug (Mirakl). Credentials stay on the server.
//
// To keep API usage low:
//  - ChannelAdvisor is queried once per account (not once per channel) and only
//    for the three fields needed ($select).
//  - Pages after the first are fetched in parallel using the total count.
//  - Per-day totals for finished days are cached (memory + .sales-cache/), so a
//    range only asks the APIs for days it has not seen before.

import fs from "fs";
import path from "path";

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

// Mirakl marketplaces (Tesco, Superdrug) are queried directly via the Mirakl
// MMP API (GET /api/orders), authenticated with the shop API key.
const MIRAKL_CHANNELS = [
  { key: "tesco", label: "Tesco", currency: "GBP" },
  { key: "superdrug", label: "Superdrug", currency: "GBP" },
];
const MIRAKL_IGNORED_STATES = ["CANCELED", "REFUSED"];

const ALL_CHANNELS = [...CHANNELS, ...MIRAKL_CHANNELS];
const CA_PAGE_SIZE = 100;
const MIRAKL_PAGE_SIZE = 100;
const PAGE_CONCURRENCY = 5;

// ---------------------------------------------------------------- pagination

// fetchPage(offset) -> { items, total? }. The first page tells us the total, so
// the remaining pages can be requested in parallel; without a total we fall
// back to walking the pages one by one.
async function fetchPaged(fetchPage, pageSize) {
  const first = await fetchPage(0);
  const items = [...first.items];
  if (first.items.length < pageSize) return items;

  if (typeof first.total === "number") {
    const offsets = [];
    for (let o = pageSize; o < first.total; o += pageSize) offsets.push(o);
    for (let i = 0; i < offsets.length; i += PAGE_CONCURRENCY) {
      const pages = await Promise.all(
        offsets.slice(i, i + PAGE_CONCURRENCY).map((o) => fetchPage(o)),
      );
      pages.forEach((p) => items.push(...p.items));
    }
    return items;
  }

  let offset = items.length;
  for (;;) {
    const page = await fetchPage(offset);
    items.push(...page.items);
    offset += page.items.length;
    if (page.items.length < pageSize) break;
  }
  return items;
}

async function fetchMiraklOrders(baseUrl, apiKey, since, until) {
  return fetchPaged(async (offset) => {
    const url = new URL("/api/orders", baseUrl);
    url.search = new URLSearchParams({
      start_date: since,
      end_date: until,
      max: String(MIRAKL_PAGE_SIZE),
      offset: String(offset),
    }).toString();
    const response = await fetch(url, {
      headers: { Authorization: apiKey, Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `Mirakl orders request failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
      );
    }
    const body = await response.json();
    return { items: body.orders || [], total: body.total_count };
  }, MIRAKL_PAGE_SIZE);
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

async function fetchCaOrders(token, profileId, filter) {
  return fetchPaged(async (skip) => {
    const url = new URL(ORDERS_URL);
    const params = {
      $filter: filter,
      $select: "SiteName,TotalPrice,CheckoutDateUtc",
      $top: String(CA_PAGE_SIZE),
      $skip: String(skip),
      profileid: profileId,
    };
    // Counting slows a request, so only the first page asks for it.
    if (skip === 0) params.$count = "true";
    url.search = new URLSearchParams(params).toString();
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(
        `CA orders request failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
      );
    }
    const body = await response.json();
    return { items: body.value || [], total: body["@odata.count"] };
  }, CA_PAGE_SIZE);
}

// --------------------------------------------------------------------- dates

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

// Calendar-day helpers on "YYYY-MM-DD" strings (London dates).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 92;
const londonDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
});

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5,
  );
}

function eachDay(from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

// Midnight (London) at the start of a "YYYY-MM-DD" day, as a UTC ISO string.
function londonDayStartUtc(dateStr) {
  return londonMidnightUtc(new Date(`${dateStr}T12:00:00Z`));
}

// London calendar day ("YYYY-MM-DD") an order timestamp falls on.
function londonDayOf(timestamp) {
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(timestamp);
  return londonDateFormat.format(
    new Date(hasZone ? timestamp : `${timestamp}Z`),
  );
}

// ?range=today|yesterday|last30, or ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive).
function resolveRange(query, today) {
  if (query.from || query.to) {
    const { from, to } = query;
    if (!DATE_RE.test(from || "") || !DATE_RE.test(to || "")) {
      return { error: "from and to must be YYYY-MM-DD dates" };
    }
    if (from > to) return { error: "from must not be after to" };
    if (daysBetween(from, to) >= MAX_RANGE_DAYS) {
      return { error: `Date range is limited to ${MAX_RANGE_DAYS} days` };
    }
    return { from, to };
  }
  if (query.range === "yesterday") {
    const y = addDays(today, -1);
    return { from: y, to: y };
  }
  if (query.range === "last30") return { from: addDays(today, -29), to: today };
  return { from: today, to: today };
}

// --------------------------------------------------------------- daily cache

// Only days at least this many days old are cached, so late-arriving or
// cancelled orders for the last couple of days are always re-read.
const CACHE_MIN_AGE_DAYS = 2;
const CACHE_FILE = path.join(process.cwd(), ".sales-cache", "days.json");
let dayCache = null;

function loadDayCache() {
  if (!dayCache) {
    try {
      dayCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    } catch {
      dayCache = {};
    }
  }
  return dayCache;
}

function saveDayCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(dayCache));
  } catch {
    // Cache is best-effort; the in-memory copy still works.
  }
}

const hasAllChannels = (entry) =>
  entry && ALL_CHANNELS.every((c) => entry[c.key]);

// ------------------------------------------------------------------ fetching

// Per-channel order count and revenue for each London day in [from, to].
async function fetchDays(from, to, { accounts, mirakl }) {
  const since = londonDayStartUtc(from);
  const until = londonDayStartUtc(addDays(to, 1));
  const days = {};
  for (const day of eachDay(from, to)) {
    days[day] = Object.fromEntries(
      ALL_CHANNELS.map((c) => [c.key, { count: 0, revenue: 0 }]),
    );
  }
  const add = (key, timestamp, total, currency) => {
    const entry = days[londonDayOf(timestamp)]?.[key];
    if (!entry) return;
    entry.count += 1;
    entry.revenue += Number(total || 0);
    if (currency) entry.currency = currency;
  };

  const caAccounts = [...new Set(CHANNELS.map((c) => c.account))];
  await Promise.all([
    ...caAccounts.map(async (account) => {
      const channels = CHANNELS.filter((c) => c.account === account);
      const sites = channels
        .map((c) => `SiteName eq '${c.siteName}'`)
        .join(" or ");
      const filter =
        `(${sites}) and CheckoutDateUtc ge ${since}` +
        ` and CheckoutDateUtc lt ${until}`;
      const token = await getAccessToken(accounts[account]);
      const orders = await fetchCaOrders(
        token,
        accounts[account].profileId,
        filter,
      );
      for (const o of orders) {
        const channel = channels.find((c) => c.siteName === o.SiteName);
        if (channel) add(channel.key, o.CheckoutDateUtc, o.TotalPrice);
      }
    }),
    ...MIRAKL_CHANNELS.map(async (channel) => {
      const { apiKey, baseUrl } = mirakl[channel.key];
      const orders = await fetchMiraklOrders(baseUrl, apiKey, since, until);
      for (const o of orders) {
        if (MIRAKL_IGNORED_STATES.includes(o.order_state)) continue;
        add(channel.key, o.created_date, o.total_price, o.currency_iso_code);
      }
    }),
  ]);
  return days;
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
  const mirakl = {
    tesco: {
      apiKey: process.env.GATSBY_MIRAKL_TESCO_API_KEY,
      baseUrl: process.env.GATSBY_MIRAKL_TESCO_BASE_URL,
    },
    superdrug: {
      apiKey: process.env.GATSBY_MIRAKL_SUPERDRUG_API_KEY,
      baseUrl: process.env.GATSBY_MIRAKL_SUPERDRUG_BASE_URL,
    },
  };
  const miraklMissing = Object.entries(mirakl).flatMap(([name, creds]) =>
    [
      !creds.apiKey && `GATSBY_MIRAKL_${name.toUpperCase()}_API_KEY`,
      !creds.baseUrl && `GATSBY_MIRAKL_${name.toUpperCase()}_BASE_URL`,
    ].filter(Boolean),
  );
  const envNames = {
    applicationId: "APPLICATION_ID",
    sharedSecret: "SHARED_SECRET",
    refreshToken: "REFRESH_TOKEN",
    profileId: "PROFILE_ID",
  };
  const missing = Object.entries(accounts)
    .flatMap(([account, creds]) =>
      Object.keys(creds)
        .filter((field) => !creds[field])
        .map((field) => `GATSBY_CA_${account}_${envNames[field]}`),
    )
    .concat(miraklMissing);
  if (missing.length) {
    return res
      .status(500)
      .json({ error: `Missing environment variables: ${missing.join(", ")}` });
  }

  const query = req.query || {};
  const today = londonDateFormat.format(new Date());
  const range = resolveRange(query, today);
  if (range.error) return res.status(400).json({ error: range.error });
  const { from, to } = range;

  try {
    const cache = loadDayCache();
    const cacheableUpTo = addDays(today, -CACHE_MIN_AGE_DAYS);
    const wanted = eachDay(from, to);
    // Days we cannot answer from the cache; ?refresh=1 forces everything.
    const needed = wanted.filter(
      (day) =>
        query.refresh || day > cacheableUpTo || !hasAllChannels(cache[day]),
    );

    const fresh = {};
    if (needed.length) {
      // One query covering the first to last missing day (usually the tail).
      const fetched = await fetchDays(needed[0], needed[needed.length - 1], {
        accounts,
        mirakl,
      });
      let cacheChanged = false;
      for (const [day, entry] of Object.entries(fetched)) {
        fresh[day] = entry;
        if (day <= cacheableUpTo) {
          cache[day] = entry;
          cacheChanged = true;
        }
      }
      if (cacheChanged) saveDayCache();
    }

    const channels = ALL_CHANNELS.map((channel) => {
      let orderCount = 0;
      let revenue = 0;
      let currency;
      for (const day of wanted) {
        const entry = (fresh[day] || cache[day])[channel.key];
        orderCount += entry.count;
        revenue += entry.revenue;
        currency = entry.currency || currency;
      }
      return {
        key: channel.key,
        label: channel.label,
        currency: currency || channel.currency,
        orderCount,
        revenue: Math.round(revenue * 100) / 100,
      };
    });

    res.status(200).json({
      from,
      to,
      since: londonDayStartUtc(from),
      until: londonDayStartUtc(addDays(to, 1)),
      daysFetched: needed.length,
      daysFromCache: wanted.length - needed.length,
      channels,
    });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
}
