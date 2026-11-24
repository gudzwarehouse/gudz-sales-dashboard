# Gudz Sales Dashboard ![Dashboard](https://img.shields.io/badge/Dashboard-brightgreen)

A Gatsby 5 dashboard that shows order counts and revenue for every Gudz sales
channel in one place: Amazon UK (FBM and FBA), Shopify (retail and wholesale), eBay UK, Temu UK, Amazon Ireland, Tesco,
Superdrug and Holland & Barrett. The browser calls one Gatsby Function
(`/api/today-sales`), which pulls the numbers from each channel's API, so no
credentials ever reach the page.

## What it does

1. **Shows the sales for a range**: Today, Yesterday, Last 30 days, Pick a date (one day from a calendar) or Custom range (a start and end date). The header shows the range and the dates it covers, in London time.
2. **Reads each channel from its own source**:
   - **Amazon UK (FBM and FBA), Shopify (retail and wholesale), eBay UK, Temu UK, Amazon Ireland**: ChannelAdvisor (Rithum) OData API. The UK and Ireland accounts have separate credentials, and each channel is picked out by its site name (see `src/server/channels.js`). Amazon UK orders are split by `DistributionCenterTypeRollup`: `ExternallyManaged` orders (shipped by Amazon) are FBA, the rest are FBM. They are fetched and cached as two channels (`amazon_uk`, `amazon_fba_uk`) but shown as one Amazon UK tile whose `parts` list FBM and FBA. The tile also has two service levels (`levels`), both of them FBM orders: **Prime** is any order whose `OrderTags` include `AmazonMerchantPrime` (Seller Fulfilled Prime), and **Premium** is any other order whose `RequestedShippingClass` is `NextDay` or `SecondDay`. The FBM row counts only the remaining standard orders, so FBM + FBA + Prime + Premium adds up to the tile total. Shopify orders (site name `Shopify`) are split by `OrderTags`: any order tagged with `wholesale` is Wholesale, the rest Retail (`shopify`, `shopify_wholesale`), shown as one Shopify tile.

     ChannelAdvisor orders are dated by **order date** (`CreatedDateUtc`, when the customer placed the order), as in Seller Central and ChannelAdvisor's own order exports, not by checkout date. The checkout date is only set once payment completes, so it can fall on a later day, and an unpaid order is given one when it is cancelled. **Cancelled orders** (`ShippingStatus` `Canceled`) are never counted. ChannelAdvisor ignores a `ShippingStatus` filter in the query, so they are dropped after fetching.

   - **Tesco, Superdrug**: Mirakl Connect API, using `start_date` and `end_date`.
   - **Holland & Barrett**: the DC/Helm API. H&B has no API of its own, so the orders that the H&B Order Feeding automation creates in Helm (tagged "H&B Order") are counted instead. The day is the time the order was created in Helm (`date_received`), not the customer's order time, and cancelled orders are skipped, so the numbers can differ slightly from the H&B vendor portal. Today's orders only appear once the automation has run.

3. **Counts per day and per channel**: each order is placed on its London calendar day, and a channel's revenue is added up in its own currency (Amazon Ireland is EUR, the rest GBP). The KPI cards at the top total the orders and the GBP revenue.
4. **Caches finished days**: a day is saved for good once it is 3 days old (`CACHE_MIN_AGE_DAYS` in `src/server/cache.js`), so Last 30 days only fetches the days it hasn't seen. Today, yesterday and the day before are always read live, because some orders (nearly all Amazon UK, held until payment clears) reach ChannelAdvisor hours or days after the day they were placed. A day saved too early would miss them for good. In a week of orders, 205 of 5,789 arrived after their day ended and only 12 more than a day late. The cache is the Upstash Redis database when `GATSBY_UPSTASH_REDIS_REST_URL` and `_TOKEN` are set (as on Netlify), and files in `.sales-cache/` otherwise. Add `?refresh=1` to the API call to bypass the cache. The cache names carry a version (`days-v2`, `bestsellers-v5`, `supplierdays-v2`); bump it when the counting rules change, so every day is fetched again under the new rules.
5. **Shows a card per channel** with its logo, orders, revenue and share of the total, then a **Share by channel** donut chart (switch between Orders and Revenue; Amazon Ireland is left out of the revenue view because it's in EUR).
6. **Breaks a channel down by supplier and manufacturer**: click a channel card to open its page (`/channel/`), with an overview (orders, revenue, FBM/FBA and Prime/Premium for Amazon UK), its best sellers and its sales by supplier or manufacturer (units, orders, revenue and share). Everything comes from the ChannelAdvisor catalogue, looked up by the SKU sold: the supplier (`SupplierName`), the manufacturer, the pack size (the `Unit Count` attribute) and the item SKU (the `Our SKU` attribute, which matches the Helm SKU). Units are the quantity sold times the pack size. SKUs ChannelAdvisor doesn't know are shown as "SKU not in ChannelAdvisor", and items without a supplier as "No supplier set". Only Holland & Barrett uses Helm, because its orders live there, so its supplier and pack size still come from Helm. Revenue here is the item price, so it leaves out postage and won't match the channel total.
7. **Shows the best sellers**: two KPI cards and a line on each channel card. The best selling SKU is the item SKU (`Our SKU`) with the most units sold (quantity times pack size), and the best selling product is the listing SKU with the most quantity sold. They load after the sales figures because they read every order line. Each finished day's totals are saved (`bestsellers-v5`), so only new days and the live ones are fetched.
8. **Shows sales by supplier**: a **By supplier** section with a card per supplier (logo, orders, GBP revenue plus any EUR, share of GBP item revenue, units, its channels and its best sellers). Click a card to open the supplier's page (`/supplier/`), which mirrors the channel page with the breakdown reversed: by channel, brand, SKU or product. The figures come from the same pass over the order lines as the best sellers, so they cost no extra ChannelAdvisor calls, and each finished day is saved per channel (`supplierdays-v2`). Supplier names are matched ignoring case, and Helm's names for the same supplier are mapped to the ChannelAdvisor one in `src/server/supplierNames.js`. Revenue is the item price (no postage), kept per currency; a bundle made of items from several suppliers is shared between them by pack quantity, and Shopify includes Rio wholesale. Logos are in `src/images/suppliers/`; a supplier without one shows a lettered badge.
9. **Keeps one channel's failure from hiding the rest**: a channel that errors shows the error on its own card and is left out of the totals, and the other channels still load. Missing credentials are reported by name, in one message.

## Usage

```bat
npm install
copy .env.example .env
npm run develop
```

Fill in `.env` (see [Environment](#environment)), then open
http://localhost:8000. The `.env` file is git-ignored. Restart the dev server
after changing it, because the values are read when the server starts.

Gatsby 5 supports Node 18 to 22 (Node 26 isn't supported yet).

| Command           | What it does                         |
| ----------------- | ------------------------------------ |
| `npm run develop` | Dev server with the API on port 8000 |
| `npm run build`   | Production build into `public`       |
| `npm run serve`   | Serves the production build          |
| `npm run clean`   | Clears `.cache` and `public`         |

Don't run `gatsby build` while the dev server is running, because they share
the `.cache` folder. Gatsby Functions need a host that runs them (Gatsby
Cloud, Netlify, or `gatsby develop`); a plain static host won't serve
`/api/today-sales`.

### Environment

Set these in `.env` (the template is `.env.example`):

| Variable                                                                          | Used for                        |
| --------------------------------------------------------------------------------- | ------------------------------- |
| `GATSBY_CA_UK_APPLICATION_ID`, `_SHARED_SECRET`, `_REFRESH_TOKEN`, `_PROFILE_ID`  | ChannelAdvisor, UK account      |
| `GATSBY_CA_IRE_APPLICATION_ID`, `_SHARED_SECRET`, `_REFRESH_TOKEN`, `_PROFILE_ID` | ChannelAdvisor, Ireland account |
| `GATSBY_MIRAKL_TESCO_API_KEY`, `_BASE_URL`                                        | Tesco (Mirakl)                  |
| `GATSBY_MIRAKL_SUPERDRUG_API_KEY`, `_BASE_URL`                                    | Superdrug (Mirakl)              |
| `GATSBY_HELM_BASE_URL`, `_EMAIL`, `_PASSWORD`                                     | Holland & Barrett (DC/Helm)     |
| `GATSBY_UPSTASH_REDIS_REST_URL`, `_TOKEN`                                         | Shared cache (optional)         |

The H&B values are the same as `DC_API_BASE_URL`, `HELM_EMAIL` and
`HELM_PASSWORD` in the `holland-and-barrett-helm-order-feeding-automation`
project. Without the Upstash values the cache is kept in `.sales-cache/`, which
suits local development; a deployed site needs them, because each function
instance has its own disk.

### API

```text
GET /api/today-sales?range=today|yesterday|last30
GET /api/today-sales?from=YYYY-MM-DD&to=YYYY-MM-DD
GET /api/today-sales?range=today&refresh=1
```

Returns `{ from, to, channels: [{ key, label, currency, orderCount, revenue, parts?, levels?, error? }] }`.
An unknown range, a bad date or a range that ends before it starts returns a
400 with a message.

```text
GET /api/supplier-sales?channel=amazon_uk&range=yesterday
GET /api/supplier-sales?channel=tesco&from=YYYY-MM-DD&to=YYYY-MM-DD
```

Returns `{ channel, label, currency, from, to, sections: [{ label, suppliers: [{ name, units, revenue, lines }] }] }`, where `label` is FBM/FBA for Amazon UK and null elsewhere,
largest revenue first. It takes the same range parameters as `today-sales`.
Helm limits how fast it can be called, so the first request for a lot of new
SKUs can take a while; looked-up SKUs are remembered for an hour.

```text
GET /api/best-sellers?range=yesterday
GET /api/supplier-detail?supplier=clf&range=last30
```

`best-sellers` returns `{ overall, channels, suppliers }`: the best sellers
overall and per channel, plus the supplier summary behind the By supplier
cards. `supplier-detail` returns one supplier's sections (one per currency),
each broken down by channel, manufacturer, SKU and product. `supplier` is the
supplier name in lower case. Both take the same range parameters as
`today-sales`.

## Layout

- `src/api/today-sales.js`: the Gatsby Function. Reads the credentials, validates the range and returns the per-channel numbers. Every file in `src/api/` becomes an endpoint, so helpers live in `src/server/` instead.
- `src/api/supplier-sales.js`: the Gatsby Function behind the supplier breakdown. `src/server/supplierSales.js` reads a channel's order lines and `src/server/catalogue.js` looks the SKUs up in ChannelAdvisor (and `src/server/suppliers.js` in Helm for Holland & Barrett). `src/api/best-sellers.js` finds the best sellers and the supplier summary, and `src/api/supplier-detail.js` one supplier's breakdown; `src/server/supplierNames.js` maps Helm supplier names to the ChannelAdvisor ones.
- `src/server/sales.js`: works out which days are missing from the cache, fetches them from every channel at once, and totals them.
- `src/server/channels.js`: the channel list (keys, labels, currencies, ChannelAdvisor site names) and the Prime/Premium rules.
- `src/server/channelAdvisor.js`, `mirakl.js`, `helm.js`: one client per source.
- `src/server/http.js`, `pagination.js`: JSON requests with retries and a timeout, and offset-based paging.
- `src/server/dates.js`, `cache.js`: London-day helpers and the per-day caches.
- `src/pages/index.js`: the dashboard. Holds the selected range and loads the data. `channel.js` and `supplier.js` are the channel and supplier pages, which read the range from the URL.
- `src/hooks/`: `useSales` (the sales, fetched a few days at a time for long ranges), `useBestSellers`, `useSupplierSales` and `useSupplierDetail`, each with loading, error and retry.
- `src/components/`: `Header` (range buttons), `DatePicker`, `RangeForm`, `KpiCards`, `ChannelGrid`, `ChannelCard`, `ChannelLogo`, `ChannelPie`, `SupplierCard`, `SupplierLogo`, `SupplierPanel`, `BestSellers`, `SalesReport`, `Stat`, `SkeletonGrid`, `Notice`, `SectionHead`.
- `src/constants/`: the range titles, channel and supplier colours (`dashboard.js`) and logo maps (`channelLogos.js`, `supplierLogos.js`). A colour is fixed to its channel or supplier, so it doesn't change when the others are filtered.
- `src/utils/`: number formatting and reading the page's range from the URL (`location.js`).
- `src/images/channels/`, `src/images/suppliers/`: the logos. A channel or supplier without one (such as Superdrug) shows a lettered badge.
- `src/styles/dashboard.css`: all the styles, with light and dark themes.
- `support/`: the Mirakl Connect and Rithum API reference files.
