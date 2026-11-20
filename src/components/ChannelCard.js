import * as React from "react";
import { ChannelBest } from "./BestSellers";
import ChannelLogo from "./ChannelLogo";
import { CHANNEL_COLORS } from "../constants/dashboard";
import { count, money } from "../utils/format";

const ChannelStats = ({ channel, currencyTotal, days }) => {
  const share = currencyTotal ? (channel.revenue / currencyTotal) * 100 : 0;
  return (
    <>
      <div className="channel-orders">
        {count(channel.orderCount)}
        <small>orders</small>
      </div>
      {days > 1 && (
        <div className="share-label">
          Average{" "}
          {(channel.orderCount / days).toLocaleString("en-GB", {
            maximumFractionDigits: 1,
          })}{" "}
          orders per day
        </div>
      )}
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

export const ChannelParts = ({ parts }) => (
  <div className="channel-parts">
    {parts.map((part) => (
      <div key={part.label} className="channel-part" title={part.title}>
        <span className="channel-part-label">{part.label}</span>
        <span>{count(part.orderCount)} orders</span>
        <span className="channel-part-revenue">
          {money(part.revenue, part.currency)}
        </span>
      </div>
    ))}
  </div>
);

export const SERVICE_LEVEL_LABELS = {
  prime: { label: "Prime", detail: "Seller Fulfilled Prime" },
  premium: { label: "Premium", detail: "Next day / second day" },
};

// Prime and Premium orders, laid out like the FBM / FBA rows.
const ChannelLevels = ({ levels, currency }) => (
  <ChannelParts
    parts={Object.entries(SERVICE_LEVEL_LABELS).map(([level, text]) => ({
      label: text.label,
      title: text.detail,
      orderCount: levels[level].count,
      revenue: levels[level].revenue,
      currency,
    }))}
  />
);

const ChannelCard = ({ channel, currencyTotal, days, best, onSelect }) => {
  const clickable = !channel.error && onSelect;
  const onKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(channel);
    }
  };
  return (
    <div
      className={`card channel${clickable ? " clickable" : ""}`}
      style={{ "--channel": CHANNEL_COLORS[channel.key] }}
      {...(clickable && {
        role: "button",
        tabIndex: 0,
        onClick: () => onSelect(channel),
        onKeyDown,
        "aria-label": `${channel.label}: view detailed sales`,
      })}
    >
      <div className="channel-name">
        <ChannelLogo channelKey={channel.key} label={channel.label} />
        {channel.label}
      </div>
      {channel.error ? (
        <div className="channel-error" title={channel.error}>
          <strong>Unavailable</strong>
          <span>{channel.error}</span>
        </div>
      ) : (
        <ChannelStats
          channel={channel}
          currencyTotal={currencyTotal}
          days={days}
        />
      )}
      {!channel.error && channel.parts && (
        <ChannelParts parts={channel.parts} />
      )}
      {!channel.error && channel.levels && (
        <ChannelLevels levels={channel.levels} currency={channel.currency} />
      )}
      {!channel.error && best && (
        <ChannelBest best={best.data?.channels?.[channel.key]} status={best} />
      )}
    </div>
  );
};

export default ChannelCard;
