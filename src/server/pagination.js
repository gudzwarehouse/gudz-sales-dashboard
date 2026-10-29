const PAGE_CONCURRENCY = 5;
const MAX_PAGES = 200;

const tooManyOrders = (total) =>
  new Error(
    `Too many orders to read${total ? ` (${total})` : ""}; try a shorter date range`,
  );

// Uses the first page's total to fetch the rest in parallel; without a total it
// walks the pages one by one.
export async function fetchPaged(fetchPage, pageSize) {
  const first = await fetchPage(0);
  const items = [...first.items];
  if (first.items.length < pageSize) return items;

  if (Number.isFinite(first.total)) {
    const offsets = [];
    for (let o = pageSize; o < first.total; o += pageSize) offsets.push(o);
    if (offsets.length > MAX_PAGES) throw tooManyOrders(first.total);
    for (let i = 0; i < offsets.length; i += PAGE_CONCURRENCY) {
      const pages = await Promise.all(
        offsets.slice(i, i + PAGE_CONCURRENCY).map(fetchPage),
      );
      pages.forEach((page) => items.push(...page.items));
    }
    return items;
  }

  let offset = items.length;
  for (let pages = 1; pages < MAX_PAGES; pages++) {
    const page = await fetchPage(offset);
    items.push(...page.items);
    offset += page.items.length;
    if (page.items.length < pageSize) return items;
  }
  throw tooManyOrders();
}
