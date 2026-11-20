export const CHANNELS = [
  {
    key: "amazon_uk",
    label: "Amazon UK",
    siteName: "Amazon UK",
    fulfilment: "merchant",
    group: "amazon_uk",
    groupLabel: "Fulfilled by Merchant (FBM)",
    groupShortLabel: "FBM",
    serviceLevels: true,
    account: "UK",
    currency: "GBP",
  },
  {
    key: "amazon_fba_uk",
    label: "Amazon FBA UK",
    siteName: "Amazon UK",
    fulfilment: "fba",
    group: "amazon_uk",
    groupLabel: "Fulfilled by Amazon (FBA)",
    groupShortLabel: "FBA",
    serviceLevels: true,
    account: "UK",
    currency: "GBP",
  },
  // Two Shopify stores sit under the one ChannelAdvisor site, told apart by
  // SiteAccountID: Gudz (all retail) and Rio (retail and wholesale).
  {
    key: "shopify_gudz",
    label: "Shopify Gudz",
    siteName: "Shopify",
    siteAccountId: "18089",
    group: "shopify",
    groupName: "Shopify",
    groupLabel: "Gudz",
    groupShortLabel: "Gudz",
    account: "UK",
    currency: "GBP",
  },
  {
    key: "shopify_rio",
    label: "Shopify Rio",
    siteName: "Shopify",
    siteAccountId: "18303",
    segment: "retail",
    group: "shopify",
    groupName: "Shopify",
    groupLabel: "Rio Retail",
    // Rio makes and sells its own goods, so it is its own supplier and brand.
    supplierName: "Rio",
    brandName: "Rio",
    groupShortLabel: "Rio retail",
    account: "UK",
    currency: "GBP",
  },
  {
    key: "shopify_rio_wholesale",
    label: "Shopify Rio Wholesale",
    siteName: "Shopify",
    siteAccountId: "18303",
    segment: "wholesale",
    group: "shopify",
    groupName: "Shopify",
    groupLabel: "Rio Wholesale",
    // Rio makes and sells its own goods, so it is its own supplier and brand.
    supplierName: "Rio",
    brandName: "Rio",
    groupShortLabel: "Rio wholesale",
    // Shown on its own row but left out of the order totals.
    excludeFromOrderCount: true,
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

// ChannelAdvisor marks orders that Amazon ships from its own warehouses (FBA)
// as "ExternallyManaged"; everything else is fulfilled by Gudz.
export const FBA_ROLLUP_TYPE = "ExternallyManaged";

// The Shopify store tags its B2B orders (e.g. "WholesaleHelperRegularOrderGraphQL");
// every other Shopify order is a retail sale.
const WHOLESALE_TAG = /wholesale/i;

// Whether a ChannelAdvisor order belongs to this channel.
export const channelOwnsOrder = (channel, order) => {
  const isFba = order.DistributionCenterTypeRollup === FBA_ROLLUP_TYPE;
  const isWholesale = WHOLESALE_TAG.test(order.OrderTags || "");
  return (
    channel.siteName === order.SiteName &&
    (!channel.siteAccountId ||
      channel.siteAccountId === String(order.SiteAccountID)) &&
    (!channel.fulfilment || (channel.fulfilment === "fba") === isFba) &&
    (!channel.segment || (channel.segment === "wholesale") === isWholesale)
  );
};

// Channels with `serviceLevels` also count their Prime and Premium orders.
// Amazon tags Seller Fulfilled Prime orders "AmazonMerchantPrime". Premium
// orders are non-Prime ones sent by a faster requested shipping class
// ("NextDay", "SecondDay"); Prime orders use classes such as "Prime NextDay",
// so an order is never counted in both.
export const SERVICE_LEVELS = ["prime", "premium"];
const PRIME_TAG = /AmazonMerchantPrime/i;
const PREMIUM_CLASSES = ["NextDay", "SecondDay"];

export const orderServiceLevel = (order) => {
  if (PRIME_TAG.test(order.OrderTags || "")) return "prime";
  if (PREMIUM_CLASSES.includes(order.RequestedShippingClass)) return "premium";
  return null;
};

export const MIRAKL_CHANNELS = [
  { key: "tesco", label: "Tesco", currency: "GBP" },
  { key: "superdrug", label: "Superdrug", currency: "GBP" },
];

export const HELM_CHANNEL = {
  key: "holland_barrett",
  label: "Holland & Barrett",
  currency: "GBP",
};

export const HELM_IGNORED_STATUS = /cancel/i;

export const MIRAKL_IGNORED_STATES = ["CANCELED", "REFUSED"];

export const ALL_CHANNELS = [...CHANNELS, ...MIRAKL_CHANNELS, HELM_CHANNEL];
