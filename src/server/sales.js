import {
  ALL_CHANNELS,
  CHANNELS,
  HELM_CHANNEL,
  HELM_IGNORED_STATUS,
  MIRAKL_CHANNELS,
  MIRAKL_IGNORED_STATES,
} from "./channels";
import { fetchChannelAdvisorOrders } from "./channelAdvisor";
import { isEntry } from "./cache";
import { addDays, eachDay, londonDayOf, londonDayStartUtc } from "./dates";
import { fetchHelmOrders } from "./helm";
import { fetchMiraklOrders } from "./mirakl";

const CA_ENV_FIELDS = {
  applicationId: "APPLICATION_ID",
  sharedSecret: "SHARED_SECRET",
  refreshToken: "REFRESH_TOKEN",
  profileId: "PROFILE_ID",
};

const missingMessage = (names) =>
  `Missing environment variables: ${names.join(", ")}`;

export function findConfigErrors(accounts, mirakl, helm) {
  const errors = {};

  for (const [account, creds] of Object.entries(accounts)) {
    const names = Object.entries(CA_ENV_FIELDS)
      .filter(([field]) => !creds[field])
      .map(([, suffix]) => `GATSBY_CA_${account}_${suffix}`);
    if (!names.length) continue;
    CHANNELS.filter((c) => c.account === account).forEach((c) => {
      errors[c.key] = missingMessage(names);
    });
  }

  for (const channel of MIRAKL_CHANNELS) {
    const creds = mirakl[channel.key];
    const prefix = `GATSBY_MIRAKL_${channel.key.toUpperCase()}`;
    const names = [
      !creds.apiKey && `${prefix}_API_KEY`,
      !creds.baseUrl && `${prefix}_BASE_URL`,
    ].filter(Boolean);
    if (names.length) errors[channel.key] = missingMessage(names);
  }

  const helmNames = [
    !helm.baseUrl && "GATSBY_HELM_BASE_URL",
    !helm.email && "GATSBY_HELM_EMAIL",
    !helm.password && "GATSBY_HELM_PASSWORD",
  ].filter(Boolean);
  if (helmNames.length) errors[HELM_CHANNEL.key] = missingMessage(helmNames);

  return errors;
}

function emptyDays(from, to, keys) {
  const days = {};
  for (const day of eachDay(from, to)) {
    days[day] = Object.fromEntries(
      ALL_CHANNELS.filter((c) => keys.has(c.key)).map((c) => [
        c.key,
        { count: 0, revenue: 0 },
      ]),
    );
  }
  return days;
}

async function loadChannelAdvisor({
  account,
  creds,
  keys,
  since,
  until,
  record,
}) {
  const channels = CHANNELS.filter(
    (c) => c.account === account && keys.has(c.key),
  );
  const sites = channels.map((c) => `SiteName eq '${c.siteName}'`).join(" or ");
  const filter =
    `(${sites}) and CheckoutDateUtc ge ${since}` +
    ` and CheckoutDateUtc lt ${until}`;

  const orders = await fetchChannelAdvisorOrders(creds, filter);
  for (const order of orders) {
    const channel = channels.find((c) => c.siteName === order.SiteName);
    if (channel) record(channel.key, order.CheckoutDateUtc, order.TotalPrice);
  }
}

async function loadMirakl({ channel, creds, since, until, record }) {
  const orders = await fetchMiraklOrders(
    channel.label,
    creds.baseUrl,
    creds.apiKey,
    since,
    until,
  );
  for (const order of orders) {
    if (MIRAKL_IGNORED_STATES.includes(order.order_state)) continue;
    record(
      channel.key,
      order.created_date,
      order.total_price,
      order.currency_iso_code,
    );
  }
}

async function loadHelm({ creds, from, to, record }) {
  const orders = await fetchHelmOrders(creds, from, addDays(to, 1));
  for (const order of orders) {
    if (HELM_IGNORED_STATUS.test(order.status || "")) continue;
    record(
      HELM_CHANNEL.key,
      order.date_received.slice(0, 10),
      order.total_paid,
    );
  }
}

// Returns { days, errors }. `errors` maps a channel key to why it could not be
// read; those channels have no entries in `days`.
export async function fetchDays(from, to, { accounts, mirakl, helm, keys }) {
  const since = londonDayStartUtc(from);
  const until = londonDayStartUtc(addDays(to, 1));
  const days = emptyDays(from, to, keys);
  const errors = {};

  const record = (key, timestamp, total, currency) => {
    const entry = days[londonDayOf(timestamp)]?.[key];
    if (!entry) return;
    const amount = Number(total);
    entry.count += 1;
    entry.revenue += Number.isFinite(amount) ? amount : 0;
    if (currency) entry.currency = currency;
  };

  const guard = (channelKeys, task) =>
    task().catch((error) => {
      channelKeys.forEach((key) => {
        errors[key] = error.message;
      });
    });

  const accountNames = [
    ...new Set(CHANNELS.filter((c) => keys.has(c.key)).map((c) => c.account)),
  ];

  await Promise.all([
    ...(keys.has(HELM_CHANNEL.key)
      ? [
          guard([HELM_CHANNEL.key], () =>
            loadHelm({ creds: helm, from, to, record }),
          ),
        ]
      : []),
    ...accountNames.map((account) =>
      guard(
        CHANNELS.filter((c) => c.account === account && keys.has(c.key)).map(
          (c) => c.key,
        ),
        () =>
          loadChannelAdvisor({
            account,
            creds: accounts[account],
            keys,
            since,
            until,
            record,
          }),
      ),
    ),
    ...MIRAKL_CHANNELS.filter((c) => keys.has(c.key)).map((channel) =>
      guard([channel.key], () =>
        loadMirakl({
          channel,
          creds: mirakl[channel.key],
          since,
          until,
          record,
        }),
      ),
    ),
  ]);

  return { days, errors };
}

export function buildChannels({ wanted, fresh, cache, errors }) {
  return ALL_CHANNELS.map((channel) => {
    const result = {
      key: channel.key,
      label: channel.label,
      currency: channel.currency,
      orderCount: 0,
      revenue: 0,
    };
    if (errors[channel.key]) return { ...result, error: errors[channel.key] };

    let revenue = 0;
    for (const day of wanted) {
      const entry = fresh[day]?.[channel.key] || cache[day]?.[channel.key];
      if (!isEntry(entry)) {
        return { ...result, error: "No data was returned for this channel" };
      }
      result.orderCount += entry.count;
      revenue += entry.revenue;
      result.currency = entry.currency || result.currency;
    }
    result.revenue = Math.round(revenue * 100) / 100;
    return result;
  });
}
