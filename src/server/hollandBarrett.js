import fs from "fs";
import path from "path";

const SALES_FILE = path.join(process.cwd(), ".sales-cache", "hb.json");
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const SYNC_HINT = "run scripts/hb_sales.py to refresh it";

export function readHollandBarrettDays(days) {
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(SALES_FILE, "utf8"));
  } catch {
    throw new Error(`No Holland & Barrett data yet: ${SYNC_HINT}`);
  }

  const age = Date.now() - new Date(saved?.updatedAt).getTime();
  if (!saved?.days || !Number.isFinite(age)) {
    throw new Error(`Holland & Barrett data file is unreadable: ${SYNC_HINT}`);
  }
  if (age > MAX_AGE_MS) {
    const hours = Math.round(age / 3600000);
    throw new Error(
      `Holland & Barrett data is ${hours} hours old: ${SYNC_HINT}`,
    );
  }

  const missing = days.filter((day) => !saved.days[day]);
  if (missing.length) {
    throw new Error(
      `Holland & Barrett data does not cover ${missing[0]}: ${SYNC_HINT}`,
    );
  }
  return Object.fromEntries(days.map((day) => [day, saved.days[day]]));
}
