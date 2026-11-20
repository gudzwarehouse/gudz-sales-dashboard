import * as React from "react";
import ChannelLogo from "./ChannelLogo";
import { SUPPLIER_LOGOS } from "../constants/supplierLogos";

// Supplier logos are mostly wide wordmarks, so they sit on a wider white
// plate than the square channel logos.
const SupplierLogo = ({ supplierKey, name }) => {
  const src = SUPPLIER_LOGOS[supplierKey];
  if (!src) return <ChannelLogo label={name} />;
  return (
    <span className="channel-logo supplier-logo">
      <img src={src} alt="" />
    </span>
  );
};

export default SupplierLogo;
