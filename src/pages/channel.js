import * as React from "react";
import { Link } from "gatsby";
import "../styles/dashboard.css";
import logo from "../images/gudz-logo.webp";
import { BestKpi, bestLines } from "../components/BestSellers";
import { SERVICE_LEVEL_LABELS } from "../components/ChannelCard";
import ChannelLogo from "../components/ChannelLogo";
import Notice from "../components/Notice";
import SectionHead from "../components/SectionHead";
import Stat from "../components/Stat";
import SupplierPanel from "../components/SupplierPanel";
import { CHANNEL_COLORS, CHANNEL_LABELS } from "../constants/dashboard";
import { useBestSellers } from "../hooks/useBestSellers";
import { useSales } from "../hooks/useSales";
import { eachDay } from "../server/dates";
import { count, money } from "../utils/format";
import { readPageLocation } from "../utils/location";
import { summarize } from "../utils/sales";

const Overview = ({ tile, days, currencyTotal }) => {
  const share = currencyTotal ? (tile.revenue / currencyTotal) * 100 : 0;
  if (tile.error) {
    return <Notice error>{tile.error}</Notice>;
  }
  return (
    <>
      <div className="kpis">
        <Stat
          label="Orders"
          value={count(tile.orderCount)}
          sub={
            days > 1 &&
            `Average ${(tile.orderCount / days).toLocaleString("en-GB", {
              maximumFractionDigits: 1,
            })} orders per day`
          }
        />
        <Stat
          label={`Revenue (${tile.currency})`}
          value={money(tile.revenue, tile.currency)}
          sub={`${share.toFixed(1)}% of ${tile.currency} revenue`}
        />
        {tile.parts?.map((part) => (
          <Stat
            key={part.label}
            label={part.label}
            value={money(part.revenue, part.currency)}
            sub={`${count(part.orderCount)} orders`}
          />
        ))}
      </div>
      {tile.levels && (
        <div className="kpis">
          {Object.entries(SERVICE_LEVEL_LABELS).map(([level, text]) => {
            const figures = tile.levels[level];
            const orderShare = tile.orderCount
              ? (figures.count / tile.orderCount) * 100
              : 0;
            return (
              <Stat
                key={level}
                label={`${text.label} orders (${text.detail})`}
                value={count(figures.count)}
                sub={`${orderShare.toFixed(1)}% of orders · ${money(
                  figures.revenue,
                  tile.currency,
                )}`}
              />
            );
          })}
        </div>
      )}
    </>
  );
};

const ChannelPage = ({ location }) => {
  const { key, query, title } = readPageLocation(
    location?.search || "",
    "channel",
  );
  const label = CHANNEL_LABELS[key];
  const channel = React.useMemo(() => ({ key, label }), [key, label]);
  const valid = Boolean(label && query);
  const best = useBestSellers(valid ? query : null);
  const sales = useSales(valid ? query : null);
  const tile = sales.data?.channels.find((c) => c.key === key);

  return (
    <main className="dash" style={{ "--channel": CHANNEL_COLORS[key] }}>
      <Link to="/" className="back-link">
        ← Back to dashboard
      </Link>
      {!valid ? (
        <Notice error>
          That channel or date range could not be found. Go back to the
          dashboard and choose a channel.
        </Notice>
      ) : (
        <>
          <header className="channel-header">
            <ChannelLogo channelKey={key} label={label} />
            <div>
              <h1>{label}</h1>
              <p className="dash-sub">
                {title}
                {sales.data &&
                  ` · ${
                    sales.data.from === sales.data.to
                      ? sales.data.from
                      : `${sales.data.from} to ${sales.data.to}`
                  }`}
              </p>
            </div>
          </header>

          <SectionHead title="Overview" />
          {sales.error && (
            <Notice error onRetry={sales.retry}>
              Failed to load: {sales.error}
            </Notice>
          )}
          {sales.loading && <div className="panel-loading">Loading...</div>}
          {tile && (
            <Overview
              tile={tile}
              days={eachDay(sales.data.from, sales.data.to).length}
              currencyTotal={
                summarize(sales.data.channels).revenueByCurrency[
                  tile.currency
                ] || 0
              }
            />
          )}

          <SectionHead title="Best sellers" />
          <div className="kpis kpis-best channel-best-kpis">
            {bestLines(best.data?.channels?.[key]).map((line) => (
              <BestKpi
                key={line.label}
                {...line}
                status={best}
                best={best.data?.channels?.[key]}
              />
            ))}
          </div>

          <SectionHead title="Sales breakdown" />
          <SupplierPanel channel={channel} query={query} />
        </>
      )}
    </main>
  );
};

export default ChannelPage;

export const Head = () => (
  <>
    <title>Channel sales - Gudz Sales Dashboard</title>
    <link rel="icon" href={logo} type="image/webp" />
  </>
);
