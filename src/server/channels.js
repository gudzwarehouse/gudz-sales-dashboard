export const CHANNELS = [
  {
    key: "amazon_uk",
    label: "Amazon UK",
    siteName: "Amazon UK",
    account: "UK",
    currency: "GBP",
  },
  {
    key: "ebay_uk",
    label: "eBay UK",
    siteName: "eBay Fixed Price UK",
    account: "UK",
    currency: "GBP",
  },
  {
    key: "temu_uk",
    label: "Temu UK",
    siteName: "Temu UK",
    account: "UK",
    currency: "GBP",
  },
  {
    key: "amazon_ie",
    label: "Amazon Ireland",
    siteName: "Amazon Seller Central - IE",
    account: "IRE",
    currency: "EUR",
  },
];

export const MIRAKL_CHANNELS = [
  { key: "tesco", label: "Tesco", currency: "GBP" },
  { key: "superdrug", label: "Superdrug", currency: "GBP" },
];

export const MIRAKL_IGNORED_STATES = ["CANCELED", "REFUSED"];

export const ALL_CHANNELS = [...CHANNELS, ...MIRAKL_CHANNELS];
