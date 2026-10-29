import * as React from "react";
import { CHANNEL_COLORS } from "../constants/dashboard";
import { count, money } from "../utils/format";

const SIZE = 220;
const CENTER = SIZE / 2;
const RADIUS = 104;
const HOLE = 64;
const METRICS = {
  orders: { button: "Orders", value: (c) => c.orderCount, format: count },
  revenue: {
    button: "Revenue (GBP)",
    value: (c) => (c.currency === "GBP" ? c.revenue : 0),
    format: (value) => money(value, "GBP"),
  },
};

const point = (radius, angle) =>
  `${CENTER + radius * Math.sin(angle)} ${CENTER - radius * Math.cos(angle)}`;

const slicePath = (from, to) => {
  const large = to - from > Math.PI ? 1 : 0;
  return [
    `M ${point(RADIUS, from)}`,
    `A ${RADIUS} ${RADIUS} 0 ${large} 1 ${point(RADIUS, to)}`,
    `L ${point(HOLE, to)}`,
    `A ${HOLE} ${HOLE} 0 ${large} 0 ${point(HOLE, from)}`,
    "Z",
  ].join(" ");
};

const buildSlices = (channels, metric) => {
  const items = channels
    .filter((channel) => !channel.error)
    .map((channel) => ({ channel, value: METRICS[metric].value(channel) }));
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let angle = 0;
  const slices = items.map((item) => {
    const start = angle;
    angle += total ? (item.value / total) * 2 * Math.PI : 0;
    return {
      ...item,
      start,
      end: angle,
      share: total ? item.value / total : 0,
    };
  });
  return { slices, total };
};

const ChannelPie = ({ channels }) => {
  const [metric, setMetric] = React.useState("orders");
  const [active, setActive] = React.useState(null);
  const { slices, total } = buildSlices(channels, metric);
  const { format } = METRICS[metric];
  const hovered = slices.find((slice) => slice.channel.key === active);
  const drawn = slices.filter((slice) => slice.value > 0);

  return (
    <div className="card pie">
      <div className="segmented pie-toggle">
        {Object.entries(METRICS).map(([key, { button }]) => (
          <button
            key={key}
            type="button"
            className={key === metric ? "active" : ""}
            onClick={() => setMetric(key)}
          >
            {button}
          </button>
        ))}
      </div>
      <div className="pie-body">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="pie-svg"
          role="img"
          aria-label={`${METRICS[metric].button} share by channel`}
        >
          {drawn.length === 0 && (
            <circle
              cx={CENTER}
              cy={CENTER}
              r={(RADIUS + HOLE) / 2}
              fill="none"
              stroke="var(--accent-soft)"
              strokeWidth={RADIUS - HOLE}
            />
          )}
          {drawn.map((slice) => {
            const color = CHANNEL_COLORS[slice.channel.key];
            const dim = active && active !== slice.channel.key;
            const props = {
              fill: color,
              stroke: "var(--surface)",
              strokeWidth: 2,
              opacity: dim ? 0.35 : 1,
              onMouseEnter: () => setActive(slice.channel.key),
              onMouseLeave: () => setActive(null),
            };
            return drawn.length === 1 ? (
              <path
                key={slice.channel.key}
                {...props}
                fillRule="evenodd"
                d={`${slicePath(0, Math.PI)} ${slicePath(Math.PI, 2 * Math.PI)}`}
              />
            ) : (
              <path
                key={slice.channel.key}
                {...props}
                d={slicePath(slice.start, slice.end)}
              />
            );
          })}
          <text
            x={CENTER}
            y={CENTER - 6}
            textAnchor="middle"
            className="pie-big"
          >
            {format(hovered ? hovered.value : total)}
          </text>
          <text
            x={CENTER}
            y={CENTER + 14}
            textAnchor="middle"
            className="pie-small"
          >
            {hovered
              ? `${hovered.channel.label} · ${(hovered.share * 100).toFixed(1)}%`
              : "All channels"}
          </text>
        </svg>
        <ul className="pie-legend">
          {slices.map(({ channel, value, share }) => (
            <li
              key={channel.key}
              className={active === channel.key ? "on" : ""}
              onMouseEnter={() => setActive(channel.key)}
              onMouseLeave={() => setActive(null)}
            >
              <span
                className="swatch"
                style={{ background: CHANNEL_COLORS[channel.key] }}
              />
              <span className="pie-name">{channel.label}</span>
              <span className="pie-value">{format(value)}</span>
              <span className="pie-share">{(share * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
      {metric === "revenue" && (
        <div className="share-label">
          GBP channels only; Amazon Ireland (EUR) is left out.
        </div>
      )}
    </div>
  );
};

export default ChannelPie;
