const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 92;

const londonDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
});

// Days are "YYYY-MM-DD" strings anchored at noon UTC so BST shifts never
// move them across a date boundary.
const atNoon = (day) => new Date(`${day}T12:00:00Z`);

export const londonToday = () => londonDateFormat.format(new Date());

function isRealDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const date = atNoon(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(day, days) {
  const date = atNoon(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const daysBetween = (from, to) =>
  Math.round((atNoon(to) - atNoon(from)) / 864e5);

export function eachDay(from, to) {
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

function londonMidnightUtc(now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const guess = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  const londonHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hour12: false,
    }).format(guess),
  );
  guess.setUTCHours(guess.getUTCHours() - londonHour);
  return guess.toISOString().replace(".000Z", "Z");
}

export const londonDayStartUtc = (day) => londonMidnightUtc(atNoon(day));

export function londonDayOf(timestamp) {
  if (typeof timestamp !== "string" || !timestamp) return null;
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(timestamp);
  const date = new Date(hasZone ? timestamp : `${timestamp}Z`);
  return Number.isNaN(date.getTime()) ? null : londonDateFormat.format(date);
}

export function resolveRange(query, today) {
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
    const yesterday = addDays(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (query.range === "last30") return { from: addDays(today, -29), to: today };
  if (query.range && query.range !== "today") {
    return { error: `Unknown range '${query.range}'` };
  }
  return { from: today, to: today };
}
