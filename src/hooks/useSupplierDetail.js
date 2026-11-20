import * as React from "react";
import { REQUEST_TIMEOUT_MS } from "../constants/dashboard";

const TIMEOUT = "timeout";

async function readDetail(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `The server returned an unexpected response (${response.status})`,
    );
  }
  if (!response.ok) throw new Error(body.error || response.statusText);
  if (!Array.isArray(body.sections)) {
    throw new Error("The server response was missing supplier data");
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

// One supplier's breakdown. Pass `ready` once the best sellers have loaded:
// they fill the per-day cache this reads, a few days at a time, so a long
// range doesn't have to be worked out in this one request.
export function useSupplierDetail(supplierKey, query, ready) {
  const [state, setState] = React.useState({ data: null, error: null });
  const [attempt, setAttempt] = React.useState(0);
  const active = Boolean(supplierKey && query && ready);

  React.useEffect(() => {
    if (!active) return undefined;
    setState({ data: null, error: null });

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(TIMEOUT),
      REQUEST_TIMEOUT_MS,
    );
    fetch(
      `/api/supplier-detail?supplier=${encodeURIComponent(supplierKey)}&${query}`,
      { signal: controller.signal },
    )
      .then(readDetail)
      .then((data) => setState({ data, error: null }))
      .catch((err) => {
        const superseded =
          controller.signal.aborted && controller.signal.reason !== TIMEOUT;
        if (!superseded) {
          setState({
            data: null,
            error: describeError(err, controller.signal),
          });
        }
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [active, supplierKey, query, attempt]);

  const retry = React.useCallback(() => setAttempt((n) => n + 1), []);
  const loading = active && !state.data && !state.error;
  return { ...state, loading, retry };
}
