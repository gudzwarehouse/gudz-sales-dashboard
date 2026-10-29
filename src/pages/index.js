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

const money = (value, currency) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value);

const IndexPage = () => {
  const [day, setDay] = React.useState("today");
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    setData(null);
    setError(null);
    fetch(`/api/today-sales?day=${day}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || response.statusText);
        setData(body);
      })
      .catch((err) => setError(err.message));
  }, [day]);

  const totalOrders = data?.channels.reduce((s, c) => s + c.orderCount, 0) ?? 0;
  // Channels trade in different currencies, so totals are kept per currency.
  const revenueByCurrency = {};
  data?.channels.forEach((c) => {
    revenueByCurrency[c.currency] =
      (revenueByCurrency[c.currency] ?? 0) + c.revenue;
  });

  return (
    <main style={pageStyles}>
      <h1>{day === "today" ? "Today's" : "Yesterday's"} Sales</h1>
      <div style={{ display: "flex", gap: 8 }}>
        {["today", "yesterday"].map((d) => (
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
            {d === "today" ? "Today" : "Yesterday"}
          </button>
        ))}
      </div>
      {error && <p style={{ color: "#b00020" }}>Failed to load: {error}</p>}
      {!data && !error && <p>Loading…</p>}
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
