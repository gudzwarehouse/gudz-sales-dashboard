import * as React from "react";
import Notice from "./Notice";
import { CHANNEL_COLORS } from "../constants/dashboard";
import { useSupplierSales } from "../hooks/useSupplierSales";
import { count, money } from "../utils/format";

const VIEWS = {
  suppliers: { button: "Supplier", noun: "supplier" },
  manufacturers: { button: "Brand", noun: "brand" },
  skus: { button: "SKU", noun: "SKU" },
  products: { button: "Product", noun: "product" },
};

// The views that list only their top rows until the user asks for more.
const LIMITS = { manufacturers: 10, skus: 10, products: 10 };

// A supplier's breakdown is the channel's turned around: by channel first.
export const SUPPLIER_VIEWS = {
  channels: { button: "Channel", noun: "channel" },
  manufacturers: VIEWS.manufacturers,
  skus: VIEWS.skus,
  products: VIEWS.products,
};

const SupplierTable = ({
  suppliers,
  currency,
  heading,
  limit,
  showSold,
  emptyText,
}) => {
  const [expanded, setExpanded] = React.useState(false);
  const total = suppliers.reduce((sum, s) => sum + s.revenue, 0);
  const totalUnits = suppliers.reduce((sum, s) => sum + s.units, 0);
  const hidden = limit && !expanded ? suppliers.length - limit : 0;
  const shown = hidden > 0 ? suppliers.slice(0, limit) : suppliers;
  if (!suppliers.length) {
    return <Notice>{emptyText}</Notice>;
  }
  return (
    <div className="table-wrap">
      <table className="supplier-table">
        <thead>
          <tr>
            <th>{heading}</th>
            {showSold && <th className="num">Packs</th>}
            <th className="num">Units</th>
            <th className="num">Orders</th>
            <th className="num">Revenue</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((supplier, index) => {
            const share = total ? (supplier.revenue / total) * 100 : 0;
            return (
              <tr key={supplier.name} className={index === 0 ? "top-row" : ""}>
                <td>
                  <div className="supplier-name">{supplier.name}</div>
                  {supplier.title && (
                    <div className="supplier-title">{supplier.title}</div>
                  )}
                  <div className="share">
                    <div style={{ width: `${share}%` }} />
                  </div>
                </td>
                {showSold && (
                  <td className="num">{count(supplier.quantity)}</td>
                )}
                <td className="num">{count(supplier.units)}</td>
                <td className="num">{count(supplier.orders)}</td>
                <td className="num">{money(supplier.revenue, currency)}</td>
                <td className="num">{share.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            {showSold && <td />}
            <td className="num">{count(totalUnits)}</td>
            <td />
            <td className="num">{money(total, currency)}</td>
          </tr>
        </tfoot>
      </table>
      {limit && suppliers.length > limit && (
        <button
          type="button"
          className="show-more"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : `Show ${hidden} more`}
        </button>
      )}
    </div>
  );
};

// A breakdown card with a toggle between `views`, each a table per section.
// A section may carry its own `currency`; otherwise the data's is used.
export const Breakdown = ({
  name,
  views,
  data,
  loading,
  error,
  retry,
  color,
  emptyText,
  note,
}) => {
  const [view, setView] = React.useState(Object.keys(views)[0]);

  return (
    <section
      className="panel card"
      aria-label={`${name} sales by ${views[view].noun}`}
      style={{ "--channel": color }}
    >
      <div className="panel-head">
        <div className="channel-name">Sales by {views[view].noun}</div>
      </div>
      <div className="segmented panel-toggle">
        {Object.entries(views).map(([key, { button }]) => (
          <button
            key={key}
            type="button"
            className={key === view ? "active" : ""}
            onClick={() => setView(key)}
          >
            {button}
          </button>
        ))}
      </div>
      {loading && <div className="panel-loading">Loading sales...</div>}
      {error && (
        <Notice error onRetry={retry}>
          Failed to load: {error}
        </Notice>
      )}
      {data &&
        data.sections.map((section) => (
          <section key={section.label || "all"} className="panel-section">
            {section.label && <h3>{section.label}</h3>}
            <SupplierTable
              key={view}
              suppliers={section[view]}
              currency={section.currency || data.currency}
              heading={views[view].button}
              limit={LIMITS[view] || 0}
              showSold={view === "skus"}
              emptyText={emptyText}
            />
          </section>
        ))}
      <p className="panel-note">{note}</p>
    </section>
  );
};

const SupplierPanel = ({ channel, query }) => {
  const { data, error, loading, retry } = useSupplierSales(channel.key, query);
  return (
    <Breakdown
      name={channel.label}
      views={VIEWS}
      data={data}
      loading={loading}
      error={error}
      retry={retry}
      color={CHANNEL_COLORS[channel.key]}
      emptyText="No items were sold on this channel in this period."
      note={
        <>
          Units are the quantity sold times the pack size (the "Unit Count" in
          ChannelAdvisor). Orders count each order once per row, so rows can add
          up to more than the channel total. Revenue is the item price, so it
          leaves out postage and won't match the channel total. Suppliers and
          brands come from ChannelAdvisor; only Holland &amp; Barrett uses Helm.
        </>
      }
    />
  );
};

export default SupplierPanel;
