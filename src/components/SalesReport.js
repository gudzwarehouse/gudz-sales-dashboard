import * as React from "react";
import { navigate } from "gatsby";
import ChannelGrid from "./ChannelGrid";
import ChannelPie from "./ChannelPie";
import KpiCards from "./KpiCards";
import Notice from "./Notice";
import SectionHead from "./SectionHead";
import { SupplierGrid } from "./SupplierCard";
import { useBestSellers } from "../hooks/useBestSellers";
import { summarize } from "../utils/sales";

const SalesReport = ({ channels, days, query, onRetry }) => {
  const { totalOrders, revenueByCurrency, failed } = summarize(channels);
  const best = useBestSellers(query);
  const open = React.useCallback(
    (channel) => navigate(`/channel/?channel=${channel.key}&${query}`),
    [query],
  );
  const openSupplier = React.useCallback(
    (supplier) =>
      navigate(
        `/supplier/?supplier=${encodeURIComponent(supplier.key)}&${query}`,
      ),
    [query],
  );
  return (
    <>
      {failed.length > 0 && (
        <Notice error onRetry={onRetry}>
          {failed.map((channel) => channel.label).join(", ")} could not be
          loaded, so the totals below leave{" "}
          {failed.length === 1 ? "it" : "them"} out.
        </Notice>
      )}
      <KpiCards
        totalOrders={totalOrders}
        revenueByCurrency={revenueByCurrency}
        best={best}
      />
      <SectionHead title="By channel" />
      <ChannelGrid
        channels={channels}
        revenueByCurrency={revenueByCurrency}
        days={days}
        best={best}
        onSelect={open}
      />
      <SectionHead title="By supplier" />
      <SupplierGrid best={best} days={days} onSelect={openSupplier} />
      <SectionHead title="Share by channel" />
      <ChannelPie channels={channels} />
    </>
  );
};

export default SalesReport;
