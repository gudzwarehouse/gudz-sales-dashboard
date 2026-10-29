import * as React from "react";
import { todayIso } from "../utils/format";

const DatePicker = ({ value, onPick }) => (
  <div className="range-form">
    <label htmlFor="sales-date">Date</label>
    <input
      id="sales-date"
      type="date"
      value={value}
      max={todayIso()}
      onChange={(event) => event.target.value && onPick(event.target.value)}
    />
  </div>
);

export default DatePicker;
