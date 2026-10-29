import * as React from "react";
import { CHANNEL_LOGOS } from "../constants/channelLogos";

const ChannelLogo = ({ channelKey, label }) => {
  const src = CHANNEL_LOGOS[channelKey];
  return (
    <span className="channel-logo">
      {src ? <img src={src} alt="" /> : <b>{label.charAt(0)}</b>}
    </span>
  );
};

export default ChannelLogo;
