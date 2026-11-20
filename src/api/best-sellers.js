import { TILE_KEYS } from "../server/channels";
import { CACHE_MIN_AGE_DAYS } from "../server/cache";
import { readCredentials } from "../server/credentials";
import { addDays, londonToday, resolveRange } from "../server/dates";
import { buildBestSellers } from "../server/supplierSales";

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "no-store");

  try {
    const today = londonToday();
    const range = resolveRange(req.query || {}, today);
    if (range.error) return res.status(400).json({ error: range.error });
    const { from, to } = range;

    const best = await buildBestSellers(
      TILE_KEYS,
      readCredentials(),
      { from, to },
      addDays(today, -CACHE_MIN_AGE_DAYS),
    );
    // A warm-up only fills the cache, so the small reply saves sending data
    // the caller will ask for again.
    if (req.query?.warm)
      return res.status(200).json({ from, to, warmed: true });
    res.status(200).json({ from, to, ...best });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unexpected server error" });
  }
}
