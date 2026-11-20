import fs from "fs";
import path from "path";
import { Redis } from "@upstash/redis";

export const CACHE_MIN_AGE_DAYS = 1;

export const isEntry = (entry) =>
  Boolean(entry) &&
  Number.isFinite(entry.count) &&
  Number.isFinite(entry.revenue);

// A channel that counts Prime / Premium orders needs those figures too, so
// days cached before they were added are fetched again.
export const isChannelEntry = (channel, entry) =>
  isEntry(entry) && (!channel.serviceLevels || Boolean(entry.levels));

const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

// Hosted deployments lose local files between requests, so when Upstash Redis
// is configured each cache lives there as a hash (one field per day / SKU).
// Without it the cache falls back to files in .sales-cache, for local use.
let redis;
function getRedis() {
  if (redis === undefined) {
    const url = process.env.GATSBY_UPSTASH_REDIS_REST_URL;
    const token = process.env.GATSBY_UPSTASH_REDIS_REST_TOKEN;
    redis = url && token ? new Redis({ url, token }) : null;
  }
  return redis;
}

const HSET_BATCH = 200;

// Each store remembers what it last read or wrote so that only changed
// fields are sent back to Redis.
function createStore({ name, file, reloadEachRequest = false, migrate }) {
  const filePath = path.join(process.cwd(), ".sales-cache", file);
  let data = null;
  let written = new Map();

  async function read() {
    const client = getRedis();
    if (client) {
      try {
        const hash = await client.hgetall(`sales:${name}`);
        return isObject(hash) ? hash : {};
      } catch {
        return {};
      }
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  async function load() {
    // Files are read once per process; Redis is shared by every instance, so
    // the day cache is read again on each request to see their writes.
    if (data && !(reloadEachRequest && getRedis())) return data;
    data = await read();
    if (migrate) migrate(data);
    written = new Map(
      Object.entries(data).map(([field, value]) => [
        field,
        JSON.stringify(value),
      ]),
    );
    return data;
  }

  async function save() {
    if (!data) return;
    const client = getRedis();
    if (client) {
      const changed = {};
      for (const [field, value] of Object.entries(data)) {
        const serialised = JSON.stringify(value);
        if (written.get(field) !== serialised) {
          changed[field] = value;
          written.set(field, serialised);
        }
      }
      const fields = Object.keys(changed);
      try {
        for (let i = 0; i < fields.length; i += HSET_BATCH) {
          const batch = {};
          for (const field of fields.slice(i, i + HSET_BATCH)) {
            batch[field] = changed[field];
          }
          await client.hset(`sales:${name}`, batch);
        }
      } catch {
        // The cache is best-effort; the in-memory copy still works.
      }
      return;
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(data));
      fs.renameSync(temp, filePath);
    } catch {
      // The cache is best-effort; the in-memory copy still works.
    }
  }

  return { load, save };
}

// Days cached before Amazon FBA UK was split out still count FBA orders under
// Amazon UK, so drop that figure and let it be fetched again.
const days = createStore({
  name: "days",
  file: "days.json",
  reloadEachRequest: true,
  migrate: (cache) => {
    for (const day of Object.values(cache)) {
      if (day?.amazon_uk && !day.amazon_fba_uk) delete day.amazon_uk;
    }
  },
});

// SKU -> supplier lookups from Helm, which are slow to fetch.
const skus = createStore({ name: "suppliers", file: "suppliers.json" });

// SKU -> catalogue details (manufacturer, supplier, pack size) from
// ChannelAdvisor.
const catalogue = createStore({ name: "catalogue", file: "catalogue.json" });

// Per-day best seller totals for each channel, plus an "<channel>:overall"
// entry where wholesale is left out. Days that are over never change, so each
// is worked out once.
const bestSellers = createStore({
  name: "bestsellers-v4",
  file: "bestsellers-v4.json",
});

export const loadDayCache = days.load;
export const saveDayCache = days.save;
export const loadSkuCache = skus.load;
export const saveSkuCache = skus.save;
export const loadCatalogueCache = catalogue.load;
export const saveCatalogueCache = catalogue.save;
export const loadBestSellerCache = bestSellers.load;
export const saveBestSellerCache = bestSellers.save;
