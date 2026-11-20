import * as React from "react";
import { REQUEST_TIMEOUT_MS } from "../constants/dashboard";
import { addDays, eachDay, londonToday } from "../server/dates";

// Long ranges are loaded a few days at a time so each request finishes before
// the host's function time limit. Days already cached are quick.
export const CHUNK_DAYS = 5;
const CHUNK_CONCURRENCY = 1;

const TIMEOUT = "timeout";

async function readSales(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `The server returned an unexpected response (${response.status})`,
    );
  }
  if (!response.ok) throw new Error(body.error || response.statusText);
  if (!Array.isArray(body.channels)) {
    throw new Error("The server response was missing channel data");
  }
  return body;
}

// Works out the days a query covers, or null when it is a single day.
export function resolveDays(query) {
  const params = new URLSearchParams(query);
  const today = londonToday();
  let from = params.get("from");
  let to = params.get("to");
  if (params.get("range") === "last30") {
    from = addDays(today, -29);
    to = today;
  }
  if (!from || !to) return null;
  const days = eachDay(from, to);
  return days.length > CHUNK_DAYS ? days : null;
}

function mergeTiles(tiles) {
  const first = tiles[0];
  const merged = {
    ...first,
    orderCount: tiles.reduce((sum, t) => sum + t.orderCount, 0),
    revenue:
      Math.round(tiles.reduce((sum, t) => sum + t.revenue, 0) * 100) / 100,
    currency: tiles.find((t) => t.currency)?.currency || first.currency,
  };
  const error = tiles.find((t) => t.error)?.error;
  if (error) merged.error = error;
  if (first.parts) {
    merged.parts = first.parts.map((part, i) =>
      mergeTiles(tiles.map((t) => t.parts[i])),
    );
  }
  // Prime / Premium figures, added up across the chunks too.
  if (first.levels) {
    merged.levels = Object.fromEntries(
      Object.keys(first.levels).map((level) => {
        const figures = tiles.map((t) => t.levels?.[level]);
        const sum = (field) =>
          figures.reduce((total, f) => total + (f?.[field] || 0), 0);
        return [
          level,
          {
            count: sum("count"),
            revenue: Math.round(sum("revenue") * 100) / 100,
          },
        ];
      }),
    );
  }
  return merged;
}

function mergeChunks(bodies) {
  const channels = bodies[0].channels.map((channel, i) =>
    mergeTiles(bodies.map((body) => body.channels[i])),
  );
  return {
    ...bodies[0],
    from: bodies[0].from,
    to: bodies[bodies.length - 1].to,
    since: bodies[0].since,
    until: bodies[bodies.length - 1].until,
    channels,
  };
}

async function fetchChunked(days, signal) {
  // When the cache already holds nearly every day, one request covers the
  // whole range; only a long stretch of missing days needs splitting up.
  try {
    const probe = await fetch(
      `/api/today-sales?from=${days[0]}&to=${days[days.length - 1]}&probe=1`,
      { signal },
    );
    const { missing } = await probe.json();
    if (Array.isArray(missing)) {
      const span = missing.length
        ? eachDay(missing[0], missing[missing.length - 1]).length
        : 0;
      if (span <= CHUNK_DAYS) {
        const url = `/api/today-sales?from=${days[0]}&to=${days[days.length - 1]}`;
        return await readSales(await fetch(url, { signal }));
      }
    }
  } catch (error) {
    if (signal.aborted) throw error;
    // The probe failed, so fall back to loading in chunks.
  }
  const chunks = [];
  for (let i = 0; i < days.length; i += CHUNK_DAYS) {
    chunks.push(days.slice(i, i + CHUNK_DAYS));
  }
  const bodies = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const index = next++;
      const chunk = chunks[index];
      const url = `/api/today-sales?from=${chunk[0]}&to=${chunk[chunk.length - 1]}`;
      bodies[index] = await readSales(await fetch(url, { signal }));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker),
  );
  return mergeChunks(bodies);
}

function describeError(error, signal) {
  if (signal.reason === TIMEOUT) return "The request took too long";
  if (error instanceof TypeError) {
    return "Could not reach the server - check your connection";
  }
  return error.message;
}

export function useSales(query) {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [updatedAt, setUpdatedAt] = React.useState(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (!query) return undefined;
    setData(null);
    setUpdatedAt(null);
    setError(null);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(TIMEOUT),
      REQUEST_TIMEOUT_MS,
    );
    const days = resolveDays(query);
    (days
      ? fetchChunked(days, controller.signal)
      : fetch(`/api/today-sales?${query}`, { signal: controller.signal }).then(
          readSales,
        )
    )
      .then((body) => {
        setData(body);
        setUpdatedAt(new Date());
      })
      .catch((err) => {
        const superseded =
          controller.signal.aborted && controller.signal.reason !== TIMEOUT;
        if (!superseded) setError(describeError(err, controller.signal));
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, attempt]);

  const retry = React.useCallback(() => setAttempt((n) => n + 1), []);
  const loading = Boolean(query) && !data && !error;

  return { data, error, loading, retry, updatedAt };
}
