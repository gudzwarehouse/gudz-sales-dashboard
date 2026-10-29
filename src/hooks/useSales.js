import * as React from "react";
import { REQUEST_TIMEOUT_MS } from "../constants/dashboard";

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
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (!query) return undefined;
    setData(null);
    setError(null);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(TIMEOUT),
      REQUEST_TIMEOUT_MS,
    );
    fetch(`/api/today-sales?${query}`, { signal: controller.signal })
      .then(readSales)
      .then(setData)
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

  return { data, error, loading, retry };
}
