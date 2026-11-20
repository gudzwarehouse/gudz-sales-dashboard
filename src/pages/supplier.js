import * as React from "react";
import { Link } from "gatsby";
import "../styles/dashboard.css";
import logo from "../images/gudz-logo.webp";
import { BestKpi, bestLines } from "../components/BestSellers";
import SupplierLogo from "../components/SupplierLogo";
import Notice from "../components/Notice";
import SectionHead from "../components/SectionHead";
import Stat from "../components/Stat";
import { averagePerDay, supplierGbpTotal } from "../components/SupplierCard";
import { Breakdown, SUPPLIER_VIEWS } from "../components/SupplierPanel";
import { supplierColor } from "../constants/dashboard";
import { useBestSellers } from "../hooks/useBestSellers";
import { useSupplierDetail } from "../hooks/useSupplierDetail";
import { eachDay } from "../server/dates";
import { count, money } from "../utils/format";
import { rangeText, readPageLocation } from "../utils/location";

const Overview = ({ supplier, suppliers, days }) => {
  const gbp = supplier.revenueByCurrency.GBP || 0;
  const gbpTotal = supplierGbpTotal(suppliers);
  const share = gbpTotal ? (gbp / gbpTotal) * 100 : 0;
  return (
    <>
      <div className="kpis">
        <Stat
          label="Orders"
          value={count(supplier.orderCount)}
          sub={
            days > 1 &&
            `Average ${averagePerDay(supplier.orderCount, days)} orders per day`
          }
        />
        <Stat
          label="Revenue (GBP)"
          value={money(gbp, "GBP")}
          sub={`${share.toFixed(1)}% of GBP item revenue`}
        />
        {Object.entries(supplier.revenueByCurrency)
          .filter(([currency]) => currency !== "GBP")
          .map(([currency, revenue]) => (
            <Stat
              key={currency}
              label={`Revenue (${currency})`}
              value={money(revenue, currency)}
            />
          ))}
        <Stat label="Units sold" value={count(supplier.units)} />
      </div>
      <div className="kpis kpis-fill">
        {supplier.channels.map((channel) => (
          <Stat
            key={channel.key}
            label={channel.label}
            value={money(channel.revenue, channel.currency)}
            sub={`${count(channel.orderCount)} orders · ${count(
              channel.units,
            )} units`}
          />
        ))}
      </div>
    </>
  );
};

const SupplierPage = ({ location }) => {
  const { key, query, title } = readPageLocation(
    location?.search || "",
    "supplier",
  );
  const valid = Boolean(key && query);
  const best = useBestSellers(valid ? query : null);
  const supplier = best.data?.suppliers?.find((s) => s.key === key);
  const detail = useSupplierDetail(
    key,
    valid ? query : null,
    Boolean(supplier),
  );
  const name = supplier?.name || detail.data?.name || key;
  const color = supplierColor(key);

  return (
    <main className="dash" style={{ "--channel": color }}>
      <Link to="/" className="back-link">
        ← Back to dashboard
      </Link>
      {!valid ? (
        <Notice error>
          That supplier or date range could not be found. Go back to the
          dashboard and choose a supplier.
        </Notice>
      ) : (
        <>
          <header className="channel-header">
            <SupplierLogo supplierKey={key} name={name || "?"} />
            <div>
              <h1>{name}</h1>
              <p className="dash-sub">
                {title}
                {best.data && ` · ${rangeText(best.data)}`}
              </p>
            </div>
          </header>

          <SectionHead title="Overview" />
          {best.error && <Notice error>Failed to load: {best.error}</Notice>}
          {best.loading && <div className="panel-loading">Loading...</div>}
          {best.data && !supplier && (
            <Notice>This supplier had no sales in this period.</Notice>
          )}
          {supplier && (
            <Overview
              supplier={supplier}
              suppliers={best.data.suppliers}
              days={eachDay(best.data.from, best.data.to).length}
            />
          )}

          <SectionHead title="Best sellers" />
          <div className="kpis kpis-best channel-best-kpis">
            {bestLines(supplier).map((line) => (
              <BestKpi
                key={line.label}
                {...line}
                status={best}
                best={supplier}
              />
            ))}
          </div>

          {supplier && (
            <>
              <SectionHead title="Sales breakdown" />
              <Breakdown
                name={name}
                views={SUPPLIER_VIEWS}
                data={detail.data}
                loading={detail.loading}
                error={detail.error}
                retry={detail.retry}
                color={color}
                emptyText="This supplier sold nothing here in this period."
                note={
                  <>
                    Units are the quantity sold times the pack size. Orders
                    count each order once per row, so rows can add up to more
                    than the supplier total, and an order with items from two
                    suppliers counts for both. Revenue is the item price, so it
                    leaves out postage; a bundle made of items from several
                    suppliers is shared between them by pack quantity. Shopify
                    includes Rio wholesale orders.
                  </>
                }
              />
            </>
          )}
        </>
      )}
    </main>
  );
};

export default SupplierPage;

export const Head = () => (
  <>
    <title>Supplier sales - Gudz Sales Dashboard</title>
    <link rel="icon" href={logo} type="image/webp" />
  </>
);
