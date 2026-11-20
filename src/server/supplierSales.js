import {
  CHANNELS,
  HELM_CHANNEL,
  HELM_IGNORED_STATUS,
  MIRAKL_CHANNELS,
  MIRAKL_IGNORED_STATES,
  channelOwnsOrder,
  tileLabel,
} from "./channels";
import { resolveCatalogue } from "./catalogue";
import { fetchChannelAdvisorOrders } from "./channelAdvisor";
import {
  loadBestSellerCache,
  loadSupplierDays,
  saveBestSellerCache,
  saveSupplierDays,
} from "./cache";
import { supplierName } from "./supplierNames";
import { addDays, eachDay, londonDayOf, londonDayStartUtc } from "./dates";
import { fetchHelmOrders } from "./helm";
import { fetchMiraklOrders } from "./mirakl";
import { resolveSuppliers } from "./suppliers";

const number = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// Each loader returns sections of order lines as { label, lines }, where a line
// is { day, orderId, sku, title, quantity, revenue }. `label` names the fulfilment
// type or segment for grouped channels (Amazon UK FBM / FBA, Shopify retail / wholesale) and is null otherwise.
const toLine = (day, orderId, sku, title, quantity, revenue) => ({
  day,
  orderId,
  sku,
  title: title ? String(title) : "",
  quantity: number(quantity),
  revenue,
});

async function caSections({ channels, creds, since, until }) {
  const filter =
    `SiteName eq '${channels[0].siteName}' and CheckoutDateUtc ge ${since}` +
    ` and CheckoutDateUtc lt ${until}`;
  const orders = await fetchChannelAdvisorOrders(creds, filter, {
    withItems: true,
  });
  return channels.map((channel) => ({
    label: channel.group ? channel.groupLabel : null,
    segment: channel.segment,
    lines: orders
      .filter((order) => channelOwnsOrder(channel, order))
      .flatMap((order) =>
        (order.Items || []).map((item) => ({
          ...toLine(
            londonDayOf(order.CheckoutDateUtc),
            order.ID,
            item.Sku,
            item.Title,
            item.Quantity,
            number(item.UnitPrice) * number(item.Quantity),
          ),
          supplier: channel.supplierName,
          brand: channel.brandName,
        })),
      ),
  }));
}

async function miraklSections({ channel, creds, since, until }) {
  const orders = await fetchMiraklOrders(
    channel.label,
    creds.baseUrl,
    creds.apiKey,
    since,
    until,
  );
  const lines = orders
    .filter((order) => !MIRAKL_IGNORED_STATES.includes(order.order_state))
    .flatMap((order) =>
      (order.order_lines || []).map((line) =>
        toLine(
          londonDayOf(order.created_date),
          order.order_id,
          line.offer_sku,
          line.product_title,
          line.quantity,
          number(line.price),
        ),
      ),
    );
  return [{ label: null, lines }];
}

async function helmSections({ creds, from, to }) {
  const orders = await fetchHelmOrders(creds, from, addDays(to, 1));
  const lines = orders
    .filter((order) => !HELM_IGNORED_STATUS.test(order.status || ""))
    .flatMap((order) =>
      (order.inventory || []).map((line) =>
        toLine(
          String(order.date_received || "").slice(0, 10),
          order.id,
          line.sku,
          line.name,
          line.quantity,
          number(line.price),
        ),
      ),
    );
  return [{ label: null, lines }];
}

async function fetchSections(channelKey, { accounts, mirakl, helm }, range) {
  const caChannels = CHANNELS.filter((c) => (c.group || c.key) === channelKey);
  if (caChannels.length) {
    return caSections({
      channels: caChannels,
      creds: accounts[caChannels[0].account],
      ...range,
    });
  }
  const miraklChannel = MIRAKL_CHANNELS.find((c) => c.key === channelKey);
  if (miraklChannel) {
    return miraklSections({
      channel: miraklChannel,
      creds: mirakl[channelKey],
      ...range,
    });
  }
  return helmSections({ creds: helm, ...range });
}

export function findChannel(channelKey) {
  return [...CHANNELS, ...MIRAKL_CHANNELS, HELM_CHANNEL].find(
    (c) => (c.group || c.key) === channelKey,
  );
}

// Groups lines by name, ignoring case ("ECOVER" and "Ecover" are one name,
// shown as the spelling used by most lines). `split(line)` returns the
// { name, units, revenue, quantity?, title? } shares of one order line. Rows
// are sorted by `sortField`, highest first.
function totalBy(lines, split, sortField = "revenue") {
  const totals = new Map();
  for (const line of lines) {
    for (const { name, units, revenue, quantity = 0, title = "" } of split(
      line,
    )) {
      const key = name.toLowerCase();
      const entry = totals.get(key) || {
        spellings: new Map(),
        units: 0,
        quantity: 0,
        title: "",
        revenue: 0,
        orders: new Set(),
      };
      entry.spellings.set(name, (entry.spellings.get(name) || 0) + 1);
      entry.units += units;
      entry.quantity += quantity;
      entry.title ||= title;
      entry.revenue += revenue;
      entry.orders.add(line.orderId);
      totals.set(key, entry);
    }
  }
  return [...totals.values()]
    .map(({ spellings, units, quantity, title, revenue, orders }) => ({
      name: [...spellings].sort((x, y) => y[1] - x[1])[0][0],
      title,
      units,
      quantity,
      revenue: Math.round(revenue * 100) / 100,
      orders: orders.size,
    }))
    .sort((x, y) => y[sortField] - x[sortField]);
}

const packOf = (info) => info.parts.reduce((sum, part) => sum + part.pack, 0);

// A bundle line is shared between its component suppliers by pack quantity.
// A line with its own `supplier` (Rio's own goods) belongs to that supplier alone.
const bySupplier = (infoOf) => (line) => {
  if (line.supplier) {
    return [
      {
        name: line.supplier,
        units: line.quantity * packOf(infoOf(line)),
        revenue: line.revenue,
      },
    ];
  }
  const { parts } = infoOf(line);
  const packs = parts.reduce((sum, part) => sum + part.pack, 0);
  return parts.map((part) => ({
    name: part.supplier,
    units: line.quantity * part.pack,
    revenue: (line.revenue * part.pack) / packs,
  }));
};

// The manufacturer is that of the SKU sold; units still count every item in a
// pack.
const byManufacturer = (infoOf) => (line) => {
  const info = infoOf(line);
  return [
    {
      name: line.brand || info.manufacturer,
      units: line.quantity * packOf(info),
      revenue: line.revenue,
    },
  ];
};

// A listing SKU as sold, ranked by quantity sold.
const bySku = (infoOf) => (line) => [
  {
    name: line.sku,
    title: line.title,
    units: line.quantity * packOf(infoOf(line)),
    quantity: line.quantity,
    revenue: line.revenue,
  },
];

// "Our SKU", so every listing of the same item counts together, ranked by units.
const byProduct = (infoOf) => (line) => {
  const info = infoOf(line);
  return [
    {
      name: info.ourSku,
      title: line.title,
      units: line.quantity * packOf(info),
      quantity: line.quantity,
      revenue: line.revenue,
    },
  ];
};

// What is known about each SKU sold: { parts, manufacturer, ourSku }, where
// `parts` are the { supplier, pack } shares a unit of the SKU is made of.
// Everything comes from ChannelAdvisor, except for Holland & Barrett, whose
// orders and SKUs live in Helm, so Helm also supplies the supplier and pack.
async function resolveSkus(channelKey, credentials, skus) {
  const caChannel = CHANNELS.find((c) => (c.group || c.key) === channelKey);
  const account = caChannel ? caChannel.account : "UK";
  const catalogue = await resolveCatalogue(
    account,
    credentials.accounts[account],
    skus,
  );
  const helmSuppliers =
    channelKey === HELM_CHANNEL.key
      ? await resolveSuppliers(credentials.helm, skus)
      : null;

  const info = new Map();
  for (const sku of new Set(skus)) {
    const product = catalogue.get(sku);
    info.set(sku, {
      manufacturer: product.manufacturer,
      ourSku: helmSuppliers ? sku : product.ourSku,
      parts: helmSuppliers?.get(sku) || [
        { supplier: product.supplier, pack: product.unitCount },
      ],
    });
  }
  return info;
}

// Loads a channel's order lines and what is known about their SKUs:
// { sections: [{ label, lines }], infoOf(line) }.
async function loadChannel(channelKey, credentials, range) {
  const sections = (await fetchSections(channelKey, credentials, range)).map(
    ({ label, segment, lines }) => ({
      label,
      segment,
      lines: lines.filter((line) => line.sku && line.quantity > 0),
    }),
  );
  const skus = sections.flatMap(({ lines }) => lines.map((line) => line.sku));
  const info = await resolveSkus(channelKey, credentials, skus);
  return { sections, infoOf: (line) => info.get(line.sku) };
}

// Adds up units per SKU ("Our SKU", so every listing of the same item counts
// together) and quantity per listing, to find the best sellers.
function createTally() {
  const skus = new Map();
  const products = new Map();
  const bump = (map, { name, title, units, quantity, orders }) => {
    const key = name.toLowerCase();
    const entry = map.get(key) || {
      name,
      title: "",
      units: 0,
      quantity: 0,
      orders: 0,
    };
    entry.units += units;
    entry.quantity += quantity;
    entry.orders += orders;
    entry.title ||= title;
    map.set(key, entry);
  };
  return {
    add(lines, infoOf) {
      // An order with several lines of the same item still counts once.
      const seen = new Set();
      const orderCount = (kind, name, orderId) => {
        const id = `${kind}|${name.toLowerCase()}|${orderId}`;
        if (seen.has(id)) return 0;
        seen.add(id);
        return 1;
      };
      for (const line of lines) {
        const info = infoOf(line);
        const units = line.quantity * packOf(info);
        const { title, quantity, orderId } = line;
        const { ourSku } = info;
        bump(skus, {
          name: ourSku,
          title,
          units,
          quantity,
          orders: orderCount("sku", ourSku, orderId),
        });
        bump(products, {
          name: line.sku,
          title,
          units,
          quantity,
          orders: orderCount("product", line.sku, orderId),
        });
      }
    },
    // The totals as plain data, which is how a day is kept in the cache.
    snapshot() {
      return { skus: [...skus.values()], products: [...products.values()] };
    },
    merge(snapshot) {
      snapshot.skus.forEach((entry) => bump(skus, entry));
      snapshot.products.forEach((entry) => bump(products, entry));
    },
    best() {
      const top = (map, field) =>
        [...map.values()].sort((x, y) => y[field] - x[field])[0] || null;
      return {
        bestSku: top(products, "quantity"),
        bestProduct: top(skus, "units"),
      };
    },
  };
}

// Returns sections: [{ label, suppliers, manufacturers, skus, products }]. `units` is quantity sold times the pack size, so a
// line of 2 for a "pack of 6" counts 12 units.
export async function buildSupplierSales(channelKey, credentials, range) {
  const { sections, infoOf } = await loadChannel(
    channelKey,
    credentials,
    range,
  );
  return sections.map(({ label, lines }) => {
    return {
      label,
      suppliers: totalBy(lines, bySupplier(infoOf)),
      manufacturers: totalBy(lines, byManufacturer(infoOf)),
      skus: totalBy(lines, bySku(infoOf), "quantity"),
      products: totalBy(lines, byProduct(infoOf), "units"),
    };
  });
}

const roundMoney = (amount) => Math.round(amount * 100) / 100;

// One day of one channel, per supplier:
// { [supplierKey]: { n: name, o: orders, b: { [brandKey]: [brand, orders] },
//   p: { [ourSkuKey]: orders }, s: [[sku, ourSku, brand, title, quantity,
//   units, revenue, orders]] } }.
// Orders count each order once per supplier, brand, product and SKU. Kept
// compact because a day is cached for every channel.
function supplierSnapshot(lines, infoOf) {
  const suppliers = {};
  const seen = new Set();
  const once = (id) => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return 1;
  };
  const split = bySupplier(infoOf);
  for (const line of lines) {
    const info = infoOf(line);
    const brand = line.brand || info.manufacturer;
    const brandKey = brand.toLowerCase();
    const productKey = info.ourSku.toLowerCase();
    for (const share of split(line)) {
      const name = supplierName(share.name);
      const key = name.toLowerCase();
      const supplier = (suppliers[key] ||= {
        n: name,
        o: 0,
        b: {},
        p: {},
        s: {},
      });
      supplier.o += once(`s|${key}|${line.orderId}`);
      const brandEntry = (supplier.b[brandKey] ||= [brand, 0]);
      brandEntry[1] += once(`b|${key}|${brandKey}|${line.orderId}`);
      supplier.p[productKey] =
        (supplier.p[productKey] || 0) +
        once(`p|${key}|${productKey}|${line.orderId}`);
      const row = (supplier.s[line.sku] ||= [
        line.sku,
        info.ourSku,
        brand,
        line.title,
        0,
        0,
        0,
        0,
      ]);
      row[3] ||= line.title;
      row[4] += line.quantity;
      row[5] += share.units;
      row[6] += share.revenue;
      row[7] += once(`k|${key}|${line.sku}|${line.orderId}`);
    }
  }
  for (const supplier of Object.values(suppliers)) {
    supplier.s = Object.values(supplier.s).map((row) => {
      row[6] = roundMoney(row[6]);
      return row;
    });
  }
  return suppliers;
}

const tallyOf = (lines, infoOf) => {
  const tally = createTally();
  tally.add(lines, infoOf);
  return tally.snapshot();
};

// The caches a request works from. The best seller cache is read whole; the
// supplier cache only for the days and channels asked about.
async function loadCaches(channelKeys, wanted, cacheableUpTo) {
  const fields = wanted
    .filter((day) => day <= cacheableUpTo)
    .flatMap((day) => channelKeys.map((key) => `${day}|${key}`));
  const [best, suppliers] = await Promise.all([
    loadBestSellerCache(),
    loadSupplierDays(fields),
  ]);
  return { best, suppliers, newSuppliers: {} };
}

async function saveCaches(caches) {
  await Promise.all([
    saveBestSellerCache(),
    saveSupplierDays(caches.newSuppliers),
  ]);
}

// Each wanted day of one channel as { tally, overall, suppliers }: the best
// seller totals with every order, those without wholesale, and the supplier
// figures. Days up to `cacheableUpTo` are kept once worked out, so only the
// days not seen before are fetched, and one fetch fills both caches.
async function loadChannelDays(
  key,
  credentials,
  wanted,
  cacheableUpTo,
  caches,
) {
  // A day only keeps a separate `overallKey` entry when the two differ.
  const overallKey = `${key}:overall`;
  const days = {};
  const needed = [];
  for (const day of wanted) {
    const cacheable = day <= cacheableUpTo;
    const tally = cacheable && caches.best[day]?.[key];
    const suppliers = cacheable && caches.suppliers[`${day}|${key}`];
    if (tally && suppliers) {
      days[day] = {
        tally,
        overall: caches.best[day][overallKey] || tally,
        suppliers,
      };
    } else needed.push(day);
  }
  if (!needed.length) return days;

  const first = needed[0];
  const last = needed[needed.length - 1];
  const { sections, infoOf } = await loadChannel(key, credentials, {
    from: first,
    to: last,
    since: londonDayStartUtc(first),
    until: londonDayStartUtc(addDays(last, 1)),
  });
  const onDay = (list, day) => list.filter((line) => line.day === day);
  const lines = sections.flatMap((section) => section.lines);
  const retail = sections.some((s) => s.segment === "wholesale")
    ? sections.filter((s) => s.segment !== "wholesale").flatMap((s) => s.lines)
    : null;
  for (const day of needed) {
    const dayLines = onDay(lines, day);
    const tally = tallyOf(dayLines, infoOf);
    const overall = retail ? tallyOf(onDay(retail, day), infoOf) : tally;
    const suppliers = supplierSnapshot(dayLines, infoOf);
    days[day] = { tally, overall, suppliers };
    if (day <= cacheableUpTo) {
      caches.best[day] = {
        ...caches.best[day],
        [key]: tally,
        ...(retail && { [overallKey]: overall }),
      };
      caches.newSuppliers[`${day}|${key}`] = suppliers;
    }
  }
  return days;
}

// Loads every channel's days: { days: { [key]: dayData[] }, errors }.
async function loadAllChannels(channelKeys, credentials, range, cacheableUpTo) {
  const wanted = eachDay(range.from, range.to);
  const caches = await loadCaches(channelKeys, wanted, cacheableUpTo);
  const days = {};
  const errors = {};
  await Promise.all(
    channelKeys.map(async (key) => {
      try {
        days[key] = Object.values(
          await loadChannelDays(
            key,
            credentials,
            wanted,
            cacheableUpTo,
            caches,
          ),
        );
      } catch (error) {
        errors[key] = error.message || "Could not be loaded";
      }
    }),
  );
  await saveCaches(caches);
  return { days, errors };
}

const currencyOf = (channelKey) => findChannel(channelKey)?.currency || "GBP";

// Adds a supplier's day snapshots from every channel into one total, each
// figure kept apart by currency where it is money.
function newSupplierTotal(key) {
  return {
    key,
    spellings: new Map(),
    orderCount: 0,
    units: 0,
    revenueByCurrency: {},
    channels: {},
    skus: new Map(),
    products: new Map(),
    brands: new Map(),
  };
}

const bumpRow = (map, key, fields) => {
  const row = map.get(key) || {
    name: fields.name,
    title: "",
    units: 0,
    quantity: 0,
    revenue: 0,
    orders: 0,
  };
  row.title ||= fields.title || "";
  row.units += fields.units || 0;
  row.quantity += fields.quantity || 0;
  row.revenue += fields.revenue || 0;
  row.orders += fields.orders || 0;
  map.set(key, row);
};

function addSnapshot(total, channelKey, snapshot) {
  const currency = currencyOf(channelKey);
  const tag = (key) => `${currency}|${key}`;
  total.spellings.set(
    snapshot.n,
    (total.spellings.get(snapshot.n) || 0) + snapshot.o,
  );
  total.orderCount += snapshot.o;
  const channel = (total.channels[channelKey] ||= {
    key: channelKey,
    label: tileLabel(channelKey),
    currency,
    orderCount: 0,
    units: 0,
    quantity: 0,
    revenue: 0,
  });
  channel.orderCount += snapshot.o;
  for (const [brandKey, [name, orders]] of Object.entries(snapshot.b)) {
    bumpRow(total.brands, tag(brandKey), { name, orders });
  }
  for (const [productKey, orders] of Object.entries(snapshot.p)) {
    bumpRow(total.products, tag(productKey), { name: productKey, orders });
  }
  for (const [
    sku,
    ourSku,
    brand,
    title,
    quantity,
    units,
    revenue,
    orders,
  ] of snapshot.s) {
    total.units += units;
    total.revenueByCurrency[currency] =
      (total.revenueByCurrency[currency] || 0) + revenue;
    channel.units += units;
    channel.quantity += quantity;
    channel.revenue += revenue;
    bumpRow(total.skus, tag(sku), {
      name: sku,
      title,
      quantity,
      units,
      revenue,
      orders,
    });
    const productKey = tag(ourSku.toLowerCase());
    // The product's name is its "Our SKU" as spelled in the catalogue.
    bumpRow(total.products, productKey, {
      name: ourSku,
      title,
      quantity,
      units,
      revenue,
    });
    total.products.get(productKey).name = ourSku;
    bumpRow(total.brands, tag(brand.toLowerCase()), {
      name: brand,
      quantity,
      units,
      revenue,
    });
  }
}

function totalSuppliers(days, onlyKey = null) {
  const totals = new Map();
  for (const [channelKey, list] of Object.entries(days)) {
    for (const { suppliers } of list) {
      for (const [key, snapshot] of Object.entries(suppliers)) {
        if (onlyKey && key !== onlyKey) continue;
        if (!totals.has(key)) totals.set(key, newSupplierTotal(key));
        addSnapshot(totals.get(key), channelKey, snapshot);
      }
    }
  }
  return totals;
}

// The same SKU or product sold in two currencies is one row for the best
// sellers, which rank by quantity or units rather than money.
function bestOf(total) {
  const merge = (map) => {
    const rows = new Map();
    for (const [key, row] of map) {
      const name = key.slice(key.indexOf("|") + 1);
      bumpRow(rows, name, { ...row, name: row.name });
    }
    return [...rows.values()];
  };
  const top = (rows, field) =>
    rows.sort((x, y) => y[field] - x[field])[0] || null;
  const strip = (row) =>
    row && {
      name: row.name,
      title: row.title,
      units: row.units,
      quantity: row.quantity,
      orders: row.orders,
    };
  return {
    bestSku: strip(top(merge(total.skus), "quantity")),
    bestProduct: strip(top(merge(total.products), "units")),
  };
}

const nameOf = (total) =>
  [...total.spellings].sort((x, y) => y[1] - x[1])[0][0];

const roundRows = (rows) =>
  rows.map((row) => ({ ...row, revenue: roundMoney(row.revenue) }));

// The cards on the dashboard: one per supplier, highest GBP revenue first.
function summarizeSuppliers(days) {
  return [...totalSuppliers(days).values()]
    .map((total) => ({
      key: total.key,
      name: nameOf(total),
      orderCount: total.orderCount,
      units: total.units,
      revenueByCurrency: Object.fromEntries(
        Object.entries(total.revenueByCurrency).map(([c, v]) => [
          c,
          roundMoney(v),
        ]),
      ),
      channels: roundRows(Object.values(total.channels)).sort(
        (x, y) => y.revenue - x.revenue,
      ),
      ...bestOf(total),
    }))
    .sort(
      (x, y) =>
        (y.revenueByCurrency.GBP || 0) - (x.revenueByCurrency.GBP || 0) ||
        y.units - x.units,
    );
}

// Best selling SKU (most sold) and product (most units) for each channel
// and across all of them, plus every supplier's totals:
// { overall, channels: { [key]: best | { error } }, suppliers }.
export async function buildBestSellers(
  channelKeys,
  credentials,
  range,
  cacheableUpTo,
) {
  const { days, errors } = await loadAllChannels(
    channelKeys,
    credentials,
    range,
    cacheableUpTo,
  );
  const overall = createTally();
  const channels = {};
  for (const key of channelKeys) {
    if (errors[key]) {
      channels[key] = { error: errors[key] };
      continue;
    }
    const tally = createTally();
    for (const day of days[key]) {
      tally.merge(day.tally);
      // The overall best sellers leave out wholesale.
      overall.merge(day.overall);
    }
    channels[key] = tally.best();
  }
  return {
    overall: overall.best(),
    channels,
    suppliers: summarizeSuppliers(days),
  };
}

// One supplier's sales, split by currency (Amazon Ireland sells in EUR):
// { key, name, sections: [{ label, currency, channels, manufacturers, skus,
// products }], errors }. Rows use the same shape as buildSupplierSales.
export async function buildSupplierDetail(
  key,
  channelKeys,
  credentials,
  range,
  cacheableUpTo,
) {
  const { days, errors } = await loadAllChannels(
    channelKeys,
    credentials,
    range,
    cacheableUpTo,
  );
  const total = totalSuppliers(days, key).get(key);
  if (!total) return { key, name: null, sections: [], errors };

  const currencies = [
    ...new Set(Object.values(total.channels).map((c) => c.currency)),
  ].sort((x, y) => (x === "GBP" ? -1 : y === "GBP" ? 1 : x.localeCompare(y)));
  const rowsIn = (map, currency, sortField) =>
    roundRows(
      [...map]
        .filter(([rowKey]) => rowKey.startsWith(`${currency}|`))
        .map(([, row]) => row),
    ).sort((x, y) => y[sortField] - x[sortField]);

  const sections = currencies.map((currency) => ({
    label: currencies.length > 1 ? `Sales in ${currency}` : null,
    currency,
    channels: roundRows(
      Object.values(total.channels)
        .filter((c) => c.currency === currency)
        .map((c) => ({
          name: c.label,
          title: "",
          units: c.units,
          quantity: c.quantity,
          revenue: c.revenue,
          orders: c.orderCount,
        })),
    ).sort((x, y) => y.revenue - x.revenue),
    manufacturers: rowsIn(total.brands, currency, "revenue"),
    skus: rowsIn(total.skus, currency, "quantity"),
    products: rowsIn(total.products, currency, "units"),
  }));
  return { key, name: nameOf(total), sections, errors };
}
