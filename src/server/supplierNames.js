// Helm (Holland & Barrett) names some suppliers differently from the
// ChannelAdvisor catalogue, so those names are mapped onto the catalogue's.
// Names are otherwise matched ignoring case ("Rio" and "RIO" are one supplier).
const ALIASES = {
  gbkentso: "Kent",
  naturesa: "Natures Aid",
  "bodywise (uk) ltd - natracare": "BODYWISE",
  "healthy food brands limited": "Healthy Food Brands",
};

export const supplierName = (name) =>
  ALIASES[String(name).toLowerCase()] || String(name);

export const supplierKey = (name) => supplierName(name).toLowerCase();
