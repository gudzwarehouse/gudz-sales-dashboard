import * as React from "react";
import { ChannelBest } from "./BestSellers";
import { ChannelParts } from "./ChannelCard";
import ChannelLogo from "./ChannelLogo";
import Notice from "./Notice";
import SkeletonGrid from "./SkeletonGrid";
import { CHANNEL_LABELS, supplierColor } from "../constants/dashboard";
import { count, money } from "../utils/format";

// Supplier revenue is the item price (no postage), so its shares are of all
// suppliers' GBP item revenue rather than the channel totals.
export const supplierGbpTotal = (suppliers) =>
  suppliers.reduce((sum, s) => sum + (s.revenueByCurrency.GBP || 0), 0);

export const averagePerDay = (orders, days) =>
  (orders / days).toLocaleString("en-GB", { maximumFractionDigits: 1 });

const SupplierCard = ({ supplier, gbpTotal, days, status, onSelect }) => {
  const gbp = supplier.revenueByCurrency.GBP || 0;
  const others = Object.entries(supplier.revenueByCurrency).filter(
    ([currency]) => currency !== "GBP",
  );
  const share = gbpTotal ? (gbp / gbpTotal) * 100 : 0;
  const onKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(supplier);
    }
  };
  return (
    <div
      className="card channel clickable"
      style={{ "--channel": supplierColor(supplier.key) }}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(supplier)}
      onKeyDown={onKeyDown}
      aria-label={`${supplier.name}: view detailed sales`}
    >
      <div className="channel-name">
        <ChannelLogo label={supplier.name} />
        {supplier.name}
      </div>
      <div className="channel-orders">
        {count(supplier.orderCount)}
        <small>orders</small>
      </div>
      {days > 1 && (
        <div className="share-label">
          Average {averagePerDay(supplier.orderCount, days)} orders per day
        </div>
      )}
      <div className="channel-revenue">{money(gbp, "GBP")}</div>
      {others.map(([currency, revenue]) => (
        <div key={currency} className="share-label">
          + {money(revenue, currency)}
        </div>
      ))}
      <div className="share">
        <div style={{ width: `${share}%` }} />
      </div>
      <div className="share-label">
        {share.toFixed(1)}% of GBP item revenue · {count(supplier.units)} units
      </div>
      <ChannelParts
        parts={supplier.channels.map((channel) => ({
          label: channel.label,
          orderCount: channel.orderCount,
          revenue: channel.revenue,
          currency: channel.currency,
        }))}
      />
      <ChannelBest best={supplier} status={status} />
    </div>
  );
};

// `best` is the best sellers hook result, which also carries the suppliers.
export const SupplierGrid = ({ best, days, onSelect }) => {
  if (best.loading) return <SkeletonGrid />;
  if (best.error) {
    return <Notice error>Supplier sales failed to load: {best.error}</Notice>;
  }
  const suppliers = best.data?.suppliers || [];
  const failed = Object.entries(best.data?.channels || {})
    .filter(([, value]) => value?.error)
    .map(([key]) => CHANNEL_LABELS[key] || key);
  const gbpTotal = supplierGbpTotal(suppliers);
  return (
    <>
      {failed.length > 0 && (
        <Notice error>
          Some channels could not be read ({failed.join(", ")}), so the supplier
          figures leave them out.
        </Notice>
      )}
      {suppliers.length ? (
        <div className="channels">
          {suppliers.map((supplier) => (
            <SupplierCard
              key={supplier.key}
              supplier={supplier}
              gbpTotal={gbpTotal}
              days={days}
              status={best}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : (
        <Notice>No items were sold in this period.</Notice>
      )}
    </>
  );
};

export default SupplierCard;
