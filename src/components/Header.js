import * as React from "react";
import logo from "../images/gudz-logo.webp";
import { RANGES } from "../constants/dashboard";

const Header = ({ range, onChange }) => (
  <header className="dash-header">
    <div className="dash-brand">
      <img className="dash-logo" src={logo} alt="Gudz" />
      <div>
        <h1>Gudz Sales Dashboard</h1>
        <p className="dash-sub">All marketplaces in one view</p>
      </div>
    </div>
    <div className="segmented" role="tablist">
      {Object.entries(RANGES).map(([key, { button }]) => (
        <button
          key={key}
          role="tab"
          aria-selected={key === range}
          className={key === range ? "active" : ""}
          onClick={() => onChange(key)}
        >
          {button}
        </button>
      ))}
    </div>
  </header>
);

export default Header;
