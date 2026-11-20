import { RANGES } from "../constants/dashboard";

// A detail page's address carries what it is about (`param`) and the same
// date query the dashboard used, e.g. /channel/?channel=amazon_uk&range=last30
// or /supplier/?supplier=clf&from=2026-01-01&to=2026-01-31.
export function readPageLocation(search, param) {
  const params = new URLSearchParams(search);
  const key = params.get(param);
  params.delete(param);
  const query = params.toString() || null;
  const range = params.get("range");
  const title = range
    ? RANGES[range]?.button
    : params.get("from") &&
      (params.get("from") === params.get("to")
        ? params.get("from")
        : `${params.get("from")} to ${params.get("to")}`);
  return { key, query, title };
}

export const rangeText = (data) =>
  data
    ? data.from === data.to
      ? data.from
      : `${data.from} to ${data.to}`
    : "";
