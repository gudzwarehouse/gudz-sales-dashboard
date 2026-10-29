import * as React from "react";

const Notice = ({ children, error = false, onRetry }) => (
  <div className={error ? "notice error" : "notice"}>
    <span>{children}</span>
    {onRetry && (
      <button className="retry" onClick={onRetry}>
        Try again
      </button>
    )}
  </div>
);

export default Notice;
