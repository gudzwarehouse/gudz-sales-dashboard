import fs from "fs";
import path from "path";

export const CACHE_MIN_AGE_DAYS = 2;

const CACHE_FILE = path.join(process.cwd(), ".sales-cache", "days.json");

let dayCache = null;

export const isEntry = (entry) =>
  Boolean(entry) && Number.isFinite(entry.count) && Number.isFinite(entry.revenue);

export function loadDayCache() {
  if (!dayCache) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      const valid =
        parsed && typeof parsed === "object" && !Array.isArray(parsed);
      dayCache = valid ? parsed : {};
    } catch {
      dayCache = {};
    }
  }
  return dayCache;
}

export function saveDayCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const temp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(dayCache));
    fs.renameSync(temp, CACHE_FILE);
  } catch {
    // The cache is best-effort; the in-memory copy still works.
  }
}
