export const RANGES = {
  today: { title: "Today's Sales", button: "Today" },
  yesterday: { title: "Yesterday's Sales", button: "Yesterday" },
  last30: { title: "Last 30 Days' Sales", button: "Last 30 days" },
  date: { title: "Sales for Selected Date", button: "Pick a date" },
  custom: { title: "Sales for Custom Range", button: "Custom range" },
};

export const CHANNEL_COLORS = {
  amazon_uk: "#f59e0b",
  amazon_ie: "#10b981",
  shopify: "#95bf47",
  ebay_uk: "#3b82f6",
  temu_uk: "#f97316",
  tesco: "#0ea5e9",
  superdrug: "#ec4899",
  holland_barrett: "#16a34a",
};

export const CHANNEL_LABELS = {
  amazon_uk: "Amazon UK",
  amazon_ie: "Amazon Ireland",
  shopify: "Shopify",
  ebay_uk: "eBay UK",
  temu_uk: "Temu UK",
  tesco: "Tesco",
  superdrug: "Superdrug",
  holland_barrett: "Holland & Barrett",
};

// Supplier cards take a colour from their name, so a supplier keeps its
// colour whatever its rank.
const SUPPLIER_COLORS = [
  "#6366f1",
  "#14b8a6",
  "#e11d48",
  "#a855f7",
  "#0891b2",
  "#ca8a04",
  "#db2777",
  "#059669",
  "#ea580c",
  "#2563eb",
];

export const supplierColor = (key) => {
  let hash = 0;
  for (const char of String(key)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return SUPPLIER_COLORS[Math.abs(hash) % SUPPLIER_COLORS.length];
};

export const REQUEST_TIMEOUT_MS = 90000;
export const SKELETON_COUNT = 8;
