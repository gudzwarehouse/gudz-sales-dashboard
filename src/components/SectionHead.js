import * as React from "react";

const SectionHead = ({ title, from, to }) => (
  <div className="section-head">
    <h2>{title}</h2>
    {from && (
      <span className="range-label">
        {from === to ? from : `${from} to ${to}`}
      </span>
    )}
  </div>
);

export default SectionHead;
