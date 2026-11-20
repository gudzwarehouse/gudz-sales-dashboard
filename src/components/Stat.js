import * as React from "react";

const Stat = ({ label, value, sub }) => (
  <div className="card">
    <div className="kpi-label">{label}</div>
    <div className="kpi-value">{value}</div>
    {sub && <div className="kpi-sub">{sub}</div>}
  </div>
);

export default Stat;
