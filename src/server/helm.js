import { requestJson } from "./http";
import { fetchPaged } from "./pagination";

const PAGE_SIZE = 100;
const ORDER_TAG = "H&B Order";

// Helm's date range excludes its last day, so callers pass the day after.
const ukDate = (day) => day.split("-").reverse().join("/");

async function login(baseUrl, email, password) {
  const body = await requestJson(
    `${baseUrl}/auth/login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email, password, "2fa_code": null }),
    },
    "Holland & Barrett login",
  );
  if (!body?.token)
    throw new Error("Holland & Barrett login returned no token");
  return body.token;
}

export async function fetchHelmOrders({ baseUrl, email, password }, from, to) {
  let root;
  try {
    root = new URL(baseUrl).href.replace(/\/$/, "");
  } catch {
    throw new Error("Holland & Barrett base URL is not a valid URL");
  }
  const token = await login(root, email, password);

  return fetchPaged(async (offset) => {
    const params = new URLSearchParams({
      "filters[order_tags][]": ORDER_TAG,
      "filters[date_range]": `${ukDate(from)},${ukDate(to)}`,
      "filters[show_archived][]": "1",
      limit: String(PAGE_SIZE),
      page: String(offset / PAGE_SIZE + 1),
    });
    const body = await requestJson(
      `${root}/orders?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      "Holland & Barrett orders request",
    );
    if (!Array.isArray(body?.data)) {
      throw new Error("Holland & Barrett orders response had no 'data' list");
    }
    return { items: body.data, total: Number(body.total) };
  }, PAGE_SIZE);
}
