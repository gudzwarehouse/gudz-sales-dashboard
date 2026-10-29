import * as React from "react";
import ChannelGrid from "./ChannelGrid";
import KpiCards from "./KpiCards";
import Notice from "./Notice";
import SectionHead from "./SectionHead";
import { summarize } from "../utils/sales";

const SalesReport = ({ channels, onRetry }) => {
  const { totalOrders, revenueByCurrency, failed } = summarize(channels);
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
      />
      <SectionHead title="By channel" />
      <ChannelGrid channels={channels} revenueByCurrency={revenueByCurrency} />
    </>
  );
};

export default SalesReport;
