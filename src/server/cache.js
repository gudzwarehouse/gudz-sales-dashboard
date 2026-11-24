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
function createStore({ name, file, reloadEachRequest = false }) {
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

// v2: ChannelAdvisor orders are dated by order date and cancelled ones left
// out, so days cached under the old rules (checkout date) are fetched again.
const days = createStore({
  name: "days-v2",
  file: "days-v2.json",
  reloadEachRequest: true,
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
  name: "bestsellers-v5",
  file: "bestsellers-v5.json",
});

// Per-day supplier figures, one field per "<day>|<channel>" so requests
// working on different channels never overwrite each other. The hash grows
// with every day kept, so only the fields a request needs are read.
const SUPPLIER_DAYS = "supplierdays-v2";
const supplierDaysFile = path.join(
  process.cwd(),
  ".sales-cache",
  `${SUPPLIER_DAYS}.json`,
);
// Keeps each write to Redis well under its request size limit.
const SUPPLIER_WRITE_BYTES = 400000;

const readSupplierDaysFile = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(supplierDaysFile, "utf8"));
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export async function loadSupplierDays(fields) {
  if (!fields.length) return {};
  const client = getRedis();
  if (client) {
    try {
      const values = await client.hmget(`sales:${SUPPLIER_DAYS}`, ...fields);
      if (!isObject(values)) return {};
      return Object.fromEntries(
        Object.entries(values).filter(([, value]) => isObject(value)),
      );
    } catch {
      return {};
    }
  }
  const all = readSupplierDaysFile();
  return Object.fromEntries(
    fields.filter((field) => all[field]).map((field) => [field, all[field]]),
  );
}

export async function saveSupplierDays(entries) {
  const fields = Object.keys(entries);
  if (!fields.length) return;
  const client = getRedis();
  if (client) {
    try {
      let batch = {};
      let size = 0;
      for (const field of fields) {
        const bytes = JSON.stringify(entries[field]).length;
        if (size && size + bytes > SUPPLIER_WRITE_BYTES) {
          await client.hset(`sales:${SUPPLIER_DAYS}`, batch);
          batch = {};
          size = 0;
        }
        batch[field] = entries[field];
        size += bytes;
      }
      await client.hset(`sales:${SUPPLIER_DAYS}`, batch);
    } catch {
      // The cache is best-effort.
    }
    return;
  }
  try {
    const all = { ...readSupplierDaysFile(), ...entries };
    fs.mkdirSync(path.dirname(supplierDaysFile), { recursive: true });
    const temp = `${supplierDaysFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(all));
    fs.renameSync(temp, supplierDaysFile);
  } catch {
    // The cache is best-effort.
  }
}

export const loadDayCache = days.load;
export const saveDayCache = days.save;
export const loadSkuCache = skus.load;
export const saveSkuCache = skus.save;
export const loadCatalogueCache = catalogue.load;
export const saveCatalogueCache = catalogue.save;
export const loadBestSellerCache = bestSellers.load;
export const saveBestSellerCache = bestSellers.save;
