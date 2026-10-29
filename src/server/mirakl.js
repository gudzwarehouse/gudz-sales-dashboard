import { requestJson } from "./http";
import { fetchPaged } from "./pagination";

const PAGE_SIZE = 100;

export async function fetchMiraklOrders(label, baseUrl, apiKey, since, until) {
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
      max: String(PAGE_SIZE),
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
  }, PAGE_SIZE);
}
