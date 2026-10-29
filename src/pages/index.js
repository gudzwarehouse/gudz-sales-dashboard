import * as React from "react";
import "../styles/dashboard.css";
import logo from "../images/gudz-logo.webp";

const TITLES = {
  today: "Today's Sales",
  yesterday: "Yesterday's Sales",
  last30: "Last 30 Days' Sales",
  custom: "Sales for Custom Range",
};
const BUTTONS = {
  today: "Today",
  yesterday: "Yesterday",
  last30: "Last 30 days",
  custom: "Custom range",
};
const CHANNEL_COLORS = {
  amazon_uk: "#f59e0b",
  amazon_ie: "#10b981",
  ebay_uk: "#3b82f6",
  temu_uk: "#f97316",
  tesco: "#0ea5e9",
  superdrug: "#ec4899",
};

const money = (value, currency) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value);

const IndexPage = () => {
  const [day, setDay] = React.useState("today");
  const [draft, setDraft] = React.useState({ from: "", to: "" });
  const [custom, setCustom] = React.useState(null); // applied { from, to }
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (day === "custom" && !custom) return;
    setData(null);
    setError(null);
    const query =
      day === "custom" ? `from=${custom.from}&to=${custom.to}` : `range=${day}`;
    fetch(`/api/today-sales?${query}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || response.statusText);
        setData(body);
      })
      .catch((err) => setError(err.message));
  }, [day, custom]);

  const totalOrders = data?.channels.reduce((s, c) => s + c.orderCount, 0) ?? 0;
  // Channels trade in different currencies, so totals are kept per currency.
  const revenueByCurrency = {};
  data?.channels.forEach((c) => {
    revenueByCurrency[c.currency] =
      (revenueByCurrency[c.currency] ?? 0) + c.revenue;
  });
  const currencyTotal = (currency) => revenueByCurrency[currency] || 0;

  const loading = !data && !error && (day !== "custom" || custom);

  return (
    <main className="dash">
      <header className="dash-header">
        <div className="dash-brand">
          <img className="dash-logo" src={logo} alt="Gudz" />
          <div>
            <h1>Gudz Sales Dashboard</h1>
            <p className="dash-sub">All marketplaces in one view</p>
          </div>
        </div>
        <div className="segmented" role="tablist">
          {Object.keys(TITLES).map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={d === day}
              className={d === day ? "active" : ""}
              onClick={() => setDay(d)}
            >
              {BUTTONS[d]}
            </button>
          ))}
        </div>
      </header>

      {day === "custom" && (
        <form
          className="range-form"
          onSubmit={(e) => {
            e.preventDefault();
            setCustom({ ...draft });
          }}
        >
          <input
            type="date"
            required
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
          <span>to</span>
          <input
            type="date"
            required
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
          <button type="submit">Apply</button>
        </form>
      )}

      <div className="section-head">
        <h2>{TITLES[day]}</h2>
        {data && data.from !== data.to && (
          <span className="range-label">
            {data.from} to {data.to}
          </span>
        )}
        {data && data.from === data.to && (
          <span className="range-label">{data.from}</span>
        )}
      </div>

      {error && <div className="notice error">Failed to load: {error}</div>}
      {day === "custom" && !custom && (
        <div className="notice">
          Pick a start and end date, then press Apply.
        </div>
      )}

      {loading && (
        <div className="channels">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card skeleton" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="kpis">
            <div className="card">
              <div className="kpi-label">Total orders</div>
              <div className="kpi-value">
                {totalOrders.toLocaleString("en-GB")}
              </div>
            </div>
            {Object.keys(revenueByCurrency).map((currency) => (
              <div className="card" key={currency}>
                <div className="kpi-label">Revenue ({currency})</div>
                <div className="kpi-value">
                  {money(currencyTotal(currency), currency)}
                </div>
              </div>
            ))}
          </div>

          <div className="section-head">
            <h2>By channel</h2>
          </div>
          <div className="channels">
            {data.channels.map((channel) => {
              const total = currencyTotal(channel.currency);
              const pct = total ? (channel.revenue / total) * 100 : 0;
              return (
                <div
                  key={channel.key}
                  className="card channel"
                  style={{ "--channel": CHANNEL_COLORS[channel.key] }}
                >
                  <div className="channel-name">
                    <span className="dot" />
                    {channel.label}
                  </div>
                  <div className="channel-orders">
                    {channel.orderCount.toLocaleString("en-GB")}
                    <small>orders</small>
                  </div>
                  <div className="channel-revenue">
                    {money(channel.revenue, channel.currency)}
                  </div>
                  <div className="share">
                    <div style={{ width: `${pct}%` }} />
                  </div>
                  <div className="share-label">
                    {pct.toFixed(1)}% of {channel.currency} revenue
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
};

export default IndexPage;

export const Head = () => (
  <>
    <title>Gudz Sales Dashboard</title>
    <link rel="icon" href={logo} type="image/webp" />
  </>
);
