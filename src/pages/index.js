import * as React from "react";

const pageStyles = {
  color: "#232129",
  padding: 48,
  fontFamily: "-apple-system, Roboto, sans-serif",
};
const gridStyles = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
  marginTop: 24,
};
const cardStyles = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: 20,
};

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

  return (
    <main style={pageStyles}>
      <h1>{TITLES[day]}</h1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {Object.keys(TITLES).map((d) => (
          <button
            key={d}
            onClick={() => setDay(d)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #232129",
              cursor: "pointer",
              background: d === day ? "#232129" : "#fff",
              color: d === day ? "#fff" : "#232129",
            }}
          >
            {BUTTONS[d]}
          </button>
        ))}
      </div>
      {day === "custom" && (
        <form
          style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}
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
      {data && data.from !== data.to && (
        <p style={{ marginBottom: 0 }}>
          {data.from} to {data.to}
        </p>
      )}
      {error && <p style={{ color: "#b00020" }}>Failed to load: {error}</p>}
      {!data && !error && (day !== "custom" || custom) && <p>Loading…</p>}
      {day === "custom" && !custom && <p>Pick a start and end date.</p>}
      {data && (
        <>
          <p>
            {totalOrders} orders ·{" "}
            {Object.entries(revenueByCurrency)
              .map(([currency, total]) => money(total, currency))
              .join(" + ")}
          </p>
          <div style={gridStyles}>
            {data.channels.map((channel) => (
              <div key={channel.key} style={cardStyles}>
                <h2 style={{ marginTop: 0 }}>{channel.label}</h2>
                <div style={{ fontSize: 32, fontWeight: 600 }}>
                  {channel.orderCount}
                </div>
                <div>orders</div>
                <div style={{ marginTop: 12 }}>
                  {money(channel.revenue, channel.currency)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
};

export default IndexPage;

export const Head = () => <title>Today's Sales</title>;
