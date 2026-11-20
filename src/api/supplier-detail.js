import { TILE_KEYS } from "../server/channels";
import { CACHE_MIN_AGE_DAYS } from "../server/cache";
import { readCredentials } from "../server/credentials";
import { addDays, londonToday, resolveRange } from "../server/dates";
import { buildSupplierDetail } from "../server/supplierSales";

// One supplier's sales by channel, brand, SKU and product. It reads the same
// per-day cache the best sellers fill, so after the dashboard has loaded a
// range this is quick.
export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "no-store");

  try {
    const query = req.query || {};
    const key = String(query.supplier || "").toLowerCase();
    if (!key) return res.status(400).json({ error: "No supplier was given" });
    const today = londonToday();
    const range = resolveRange(query, today);
    if (range.error) return res.status(400).json({ error: range.error });
    const { from, to } = range;

    const detail = await buildSupplierDetail(
      key,
      TILE_KEYS,
      readCredentials(),
      { from, to },
      addDays(today, -CACHE_MIN_AGE_DAYS),
    );
    res.status(200).json({ from, to, ...detail });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unexpected server error" });
  }
}
