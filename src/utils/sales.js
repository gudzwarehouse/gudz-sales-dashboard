export function summarize(channels) {
  const loaded = channels.filter((channel) => !channel.error);
  const revenueByCurrency = {};
  loaded.forEach((channel) => {
    revenueByCurrency[channel.currency] =
      (revenueByCurrency[channel.currency] ?? 0) + channel.revenue;
  });
  return {
    totalOrders: loaded.reduce((sum, channel) => sum + channel.orderCount, 0),
    revenueByCurrency,
    failed: channels.filter((channel) => channel.error),
  };
}
