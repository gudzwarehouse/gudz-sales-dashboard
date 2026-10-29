import * as React from "react";
import { count, money } from "../utils/format";

const KpiCard = ({ label, value }) => (
  <div className="card">
    <div className="kpi-label">{label}</div>
    <div className="kpi-value">{value}</div>
  </div>
);

const KpiCards = ({ totalOrders, revenueByCurrency }) => (
  <div className="kpis">
    <KpiCard label="Total orders" value={count(totalOrders)} />
    {Object.entries(revenueByCurrency).map(([currency, total]) => (
      <KpiCard
        key={currency}
        label={`Revenue (${currency})`}
        value={money(total, currency)}
      />
    ))}
  </div>
);

export default KpiCards;
