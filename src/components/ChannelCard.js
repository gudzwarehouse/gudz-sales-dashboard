import * as React from "react";
import { CHANNEL_COLORS } from "../constants/dashboard";
import { count, money } from "../utils/format";

const ChannelStats = ({ channel, currencyTotal }) => {
  const share = currencyTotal ? (channel.revenue / currencyTotal) * 100 : 0;
  return (
    <>
      <div className="channel-orders">
        {count(channel.orderCount)}
        <small>orders</small>
      </div>
      <div className="channel-revenue">
        {money(channel.revenue, channel.currency)}
      </div>
      <div className="share">
        <div style={{ width: `${share}%` }} />
      </div>
      <div className="share-label">
        {share.toFixed(1)}% of {channel.currency} revenue
      </div>
    </>
  );
};

const ChannelCard = ({ channel, currencyTotal }) => (
  <div
    className="card channel"
    style={{ "--channel": CHANNEL_COLORS[channel.key] }}
  >
    <div className="channel-name">
      <span className="dot" />
      {channel.label}
    </div>
    {channel.error ? (
      <div className="channel-error" title={channel.error}>
        <strong>Unavailable</strong>
        <span>{channel.error}</span>
      </div>
    ) : (
      <ChannelStats channel={channel} currencyTotal={currencyTotal} />
    )}
  </div>
);

export default ChannelCard;
