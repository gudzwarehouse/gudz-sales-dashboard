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
//
// Failures are isolated: if one marketplace cannot be read, its channel is
// returned with an `error` and the others are still reported. Nothing from a
// failed call is ever cached.

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
// Safety net against runaway paging (e.g. a bad total or an API ignoring offset).
const MAX_PAGES = 200;

// ------------------------------------------------------------------ requests

const REQUEST_TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const errorHint = (status) => {
  if (status === 401 || status === 403) return " - check the credentials";
  if (status === 404) return " - check the base URL";
  if (status === 429) return " - rate limited";
  return "";
};

// fetch + JSON with a timeout and retries for network errors, 429 and 5xx.
// Errors carry the HTTP status as `error.status` and name the failing service.
async function requestJson(url, options, label) {
  for (let attempt = 1; ; attempt++) {
    const lastAttempt = attempt >= MAX_ATTEMPTS;
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (!lastAttempt) {
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      const reason =
        error.name === "TimeoutError"
          ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
          : error.cause?.code || error.message;
      throw new Error(`${label} could not be reached (${reason})`);
    }

    if (response.ok) {
      try {
        return await response.json();
      } catch {
        throw new Error(`${label} returned a response that was not valid JSON`);
      }
    }

    if (RETRYABLE_STATUS.has(response.status) && !lastAttempt) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait =
        retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1);
      await sleep(Math.min(wait, 5000));
      continue;
    }

    const text = (await response.text().catch(() => "")).slice(0, 300);
    const error = new Error(
      `${label} failed (${response.status})${errorHint(response.status)}${text ? `: ${text}` : ""}`,
    );
    error.status = response.status;
    throw error;
  }
}

// ---------------------------------------------------------------- pagination

// fetchPage(offset) -> { items, total? }. The first page tells us the total, so
// the remaining pages can be requested in parallel; without a total we fall
// back to walking the pages one by one.
async function fetchPaged(fetchPage, pageSize) {
  const first = await fetchPage(0);
  const items = [...first.items];
  if (first.items.length < pageSize) return items;

  if (Number.isFinite(first.total)) {
    const offsets = [];
    for (let o = pageSize; o < first.total; o += pageSize) offsets.push(o);
    if (offsets.length > MAX_PAGES) {
      throw new Error(
        `Too many orders to read (${first.total}); try a shorter date range`,
      );
    }
    for (let i = 0; i < offsets.length; i += PAGE_CONCURRENCY) {
      const pages = await Promise.all(
        offsets.slice(i, i + PAGE_CONCURRENCY).map((o) => fetchPage(o)),
      );
      pages.forEach((p) => items.push(...p.items));
    }
    return items;
  }

  let offset = items.length;
  for (let pages = 1; pages < MAX_PAGES; pages++) {
    const page = await fetchPage(offset);
    items.push(...page.items);
    offset += page.items.length;
    if (page.items.length < pageSize) return items;
  }
  throw new Error("Too many orders to read; try a shorter date range");
}

async function fetchMiraklOrders(label, baseUrl, apiKey, since, until) {
  let origin;
  try {
    origin = new URL(baseUrl);
  } catch {
    throw new Error(`${label} base URL is not a valid URL`);
  }
  return fetchPaged(async (offset) => {
    const url = new URL("/api/orders", origin);
    url.search = new URLSearchParams({
      start_date: since,
      end_date: until,
      max: String(MIRAKL_PAGE_SIZE),
      offset: String(offset),
    }).toString();
    const body = await requestJson(
      url,
      { headers: { Authorization: apiKey, Accept: "application/json" } },
      `${label} orders request`,
    );
    if (!Array.isArray(body?.orders)) {
      throw new Error(`${label} orders response had no 'orders' list`);
    }
    return { items: body.orders, total: Number(body.total_count) };
  }, MIRAKL_PAGE_SIZE);
}

// Access tokens are reused until shortly before they expire.
const tokenCache = new Map();

async function getAccessToken(creds, { force = false } = {}) {
  const cacheKey = `${creds.applicationId}|${creds.profileId}`;
  const hit = tokenCache.get(cacheKey);
  if (!force && hit && hit.expiresAt > Date.now()) return hit.token;

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
  const lifetime = Math.max(60, (Number(body.expires_in) || 3600) - 60);
  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + lifetime * 1000,
  });
  return body.access_token;
}

async function fetchCaOrders(creds, filter) {
  let token = await getAccessToken(creds);
  return fetchPaged(async (skip) => {
    const url = new URL(ORDERS_URL);
    const params = {
      $filter: filter,
      $select: "SiteName,TotalPrice,CheckoutDateUtc",
      $top: String(CA_PAGE_SIZE),
      $skip: String(skip),
      profileid: creds.profileId,
    };
    // Counting slows a request, so only the first page asks for it.
    if (skip === 0) params.$count = "true";
    url.search = new URLSearchParams(params).toString();
    const call = () =>
      requestJson(
        url,
        { headers: { Authorization: `Bearer ${token}` } },
        "ChannelAdvisor orders request",
      );

    let body;
    try {
      body = await call();
    } catch (error) {
      if (error.status !== 401) throw error;
      // The token may have been revoked or expired early: refresh once.
      token = await getAccessToken(creds, { force: true });
      body = await call();
    }
    if (!Array.isArray(body?.value)) {
      throw new Error("ChannelAdvisor orders response had no 'value' list");
    }
    return { items: body.value, total: Number(body["@odata.count"]) };
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

// True for real calendar dates only (rejects e.g. 2026-02-31 or 2026-13-01).
function isRealDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

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

// London calendar day ("YYYY-MM-DD") an order timestamp falls on, or null when
// the timestamp is missing or unreadable.
function londonDayOf(timestamp) {
  if (typeof timestamp !== "string" || !timestamp) return null;
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(timestamp);
  const date = new Date(hasZone ? timestamp : `${timestamp}Z`);
  return Number.isNaN(date.getTime()) ? null : londonDateFormat.format(date);
}

// ?range=today|yesterday|last30, or ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive).
function resolveRange(query, today) {
  if (query.from || query.to) {
    const { from, to } = query;
    if (!isRealDate(from) || !isRealDate(to)) {
      return { error: "from and to must be valid YYYY-MM-DD dates" };
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
  if (query.range && query.range !== "today") {
    return { error: `Unknown range '${query.range}'` };
  }
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
      const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      dayCache =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : {};
    } catch {
      // Missing or corrupt cache file: start empty.
      dayCache = {};
    }
  }
  return dayCache;
}

function saveDayCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    // Write then rename so a crash cannot leave a half-written cache file.
    const temp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(dayCache));
    fs.renameSync(temp, CACHE_FILE);
  } catch {
    // Cache is best-effort; the in-memory copy still works.
  }
}

const isEntry = (entry) =>
  entry && Number.isFinite(entry.count) && Number.isFinite(entry.revenue);

// ------------------------------------------------------------------ fetching

// Per-channel order count and revenue for each London day in [from, to], for
// the channels in `keys`. Returns { days, errors } where `errors` maps a channel
// key to the reason it could not be read; those channels have no entries.
async function fetchDays(from, to, { accounts, mirakl, keys }) {
  const since = londonDayStartUtc(from);
  const until = londonDayStartUtc(addDays(to, 1));
  const days = {};
  for (const day of eachDay(from, to)) {
    days[day] = Object.fromEntries(
      ALL_CHANNELS.filter((c) => keys.has(c.key)).map((c) => [
        c.key,
        { count: 0, revenue: 0 },
      ]),
    );
  }
  const errors = {};
  const failAll = (channelKeys, error) =>
    channelKeys.forEach((key) => {
      errors[key] = error.message;
    });

  const add = (key, timestamp, total, currency) => {
    const entry = days[londonDayOf(timestamp)]?.[key];
    if (!entry) return;
    const amount = Number(total);
    entry.count += 1;
    entry.revenue += Number.isFinite(amount) ? amount : 0;
    if (currency) entry.currency = currency;
  };

  const caAccounts = [
    ...new Set(CHANNELS.filter((c) => keys.has(c.key)).map((c) => c.account)),
  ];
  await Promise.all([
    ...caAccounts.map(async (account) => {
      const channels = CHANNELS.filter(
        (c) => c.account === account && keys.has(c.key),
      );
      try {
        const sites = channels
          .map((c) => `SiteName eq '${c.siteName}'`)
          .join(" or ");
        const filter =
          `(${sites}) and CheckoutDateUtc ge ${since}` +
          ` and CheckoutDateUtc lt ${until}`;
        const orders = await fetchCaOrders(accounts[account], filter);
        for (const o of orders) {
          const channel = channels.find((c) => c.siteName === o.SiteName);
          if (channel) add(channel.key, o.CheckoutDateUtc, o.TotalPrice);
        }
      } catch (error) {
        failAll(
          channels.map((c) => c.key),
          error,
        );
      }
    }),
    ...MIRAKL_CHANNELS.filter((c) => keys.has(c.key)).map(async (channel) => {
      try {
        const { apiKey, baseUrl } = mirakl[channel.key];
        const orders = await fetchMiraklOrders(
          channel.label,
          baseUrl,
          apiKey,
          since,
          until,
        );
        for (const o of orders) {
          if (MIRAKL_IGNORED_STATES.includes(o.order_state)) continue;
          add(channel.key, o.created_date, o.total_price, o.currency_iso_code);
        }
      } catch (error) {
        failAll([channel.key], error);
      }
    }),
  ]);
  return { days, errors };
}

// Names of any missing environment variables, per channel key.
function configErrors(accounts, mirakl) {
  const result = {};
  const envNames = {
    applicationId: "APPLICATION_ID",
    sharedSecret: "SHARED_SECRET",
    refreshToken: "REFRESH_TOKEN",
    profileId: "PROFILE_ID",
  };
  const message = (names) =>
    `Missing environment variables: ${names.join(", ")}`;
  for (const [account, creds] of Object.entries(accounts)) {
    const names = Object.keys(envNames)
      .filter((field) => !creds[field])
      .map((field) => `GATSBY_CA_${account}_${envNames[field]}`);
    if (!names.length) continue;
    CHANNELS.filter((c) => c.account === account).forEach((c) => {
      result[c.key] = message(names);
    });
  }
  for (const channel of MIRAKL_CHANNELS) {
    const creds = mirakl[channel.key];
    const prefix = `GATSBY_MIRAKL_${channel.key.toUpperCase()}`;
    const names = [
      !creds.apiKey && `${prefix}_API_KEY`,
      !creds.baseUrl && `${prefix}_BASE_URL`,
    ].filter(Boolean);
    if (names.length) result[channel.key] = message(names);
  }
  return result;
}

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "no-store");

  try {
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
    const errors = configErrors(accounts, mirakl);

    const query = req.query || {};
    const today = londonDateFormat.format(new Date());
    const range = resolveRange(query, today);
    if (range.error) return res.status(400).json({ error: range.error });
    const { from, to } = range;

    const cache = loadDayCache();
    const cacheableUpTo = addDays(today, -CACHE_MIN_AGE_DAYS);
    const wanted = eachDay(from, to);

    // Days each channel cannot be answered from the cache; ?refresh=1 forces all.
    const neededDays = {};
    for (const channel of ALL_CHANNELS) {
      neededDays[channel.key] = wanted.filter(
        (day) =>
          query.refresh ||
          day > cacheableUpTo ||
          !isEntry(cache[day]?.[channel.key]),
      );
    }
    const keys = new Set(
      ALL_CHANNELS.map((c) => c.key).filter(
        (key) => neededDays[key].length && !errors[key],
      ),
    );

    const fresh = {};
    if (keys.size) {
      // One query covering the first to last missing day (usually the tail).
      const allNeeded = [...keys].flatMap((key) => neededDays[key]).sort();
      const fetched = await fetchDays(
        allNeeded[0],
        allNeeded[allNeeded.length - 1],
        { accounts, mirakl, keys },
      );
      Object.assign(errors, fetched.errors);

      let cacheChanged = false;
      for (const key of keys) {
        if (errors[key]) continue; // never keep data from a failed call
        for (const [day, entries] of Object.entries(fetched.days)) {
          (fresh[day] ||= {})[key] = entries[key];
          if (day <= cacheableUpTo) {
            cache[day] = { ...cache[day], [key]: entries[key] };
            cacheChanged = true;
          }
        }
      }
      if (cacheChanged) saveDayCache();
    }

    const channels = ALL_CHANNELS.map((channel) => {
      const result = {
        key: channel.key,
        label: channel.label,
        currency: channel.currency,
        orderCount: 0,
        revenue: 0,
      };
      if (errors[channel.key]) return { ...result, error: errors[channel.key] };

      let revenue = 0;
      for (const day of wanted) {
        const entry = fresh[day]?.[channel.key] || cache[day]?.[channel.key];
        if (!isEntry(entry)) {
          return { ...result, error: "No data was returned for this channel" };
        }
        result.orderCount += entry.count;
        revenue += entry.revenue;
        result.currency = entry.currency || result.currency;
      }
      result.revenue = Math.round(revenue * 100) / 100;
      return result;
    });

    if (channels.every((c) => c.error)) {
      return res.status(502).json({
        error: `Could not load any channel. ${channels[0].label}: ${channels[0].error}`,
        channels,
      });
    }

    res.status(200).json({
      from,
      to,
      since: londonDayStartUtc(from),
      until: londonDayStartUtc(addDays(to, 1)),
      daysFetched: keys.size
        ? new Set([...keys].flatMap((k) => neededDays[k])).size
        : 0,
      channels,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unexpected server error" });
  }
}
