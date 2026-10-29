import * as React from "react";
import ChannelCard from "./ChannelCard";

const ChannelGrid = ({ channels, revenueByCurrency }) => (
  <div className="channels">
    {channels.map((channel) => (
      <ChannelCard
        key={channel.key}
        channel={channel}
        currencyTotal={revenueByCurrency[channel.currency] || 0}
      />
    ))}
  </div>
);

export default ChannelGrid;
