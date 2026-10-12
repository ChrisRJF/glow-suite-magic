// Client-side pagination over the fully loaded, filtered customer list.
export const CUSTOMER_PAGE_SIZE = 25;

export function pageCount(total: number, size = CUSTOMER_PAGE_SIZE): number {
  return total <= 0 ? 0 : Math.ceil(total / size);
}

export function clampPage(page: number, total: number, size = CUSTOMER_PAGE_SIZE): number {
  const pages = pageCount(total, size);
  if (pages === 0) return 1;
  return Math.min(Math.max(1, Math.floor(page) || 1), pages);
}

export function pageSlice<T>(items: T[], page: number, size = CUSTOMER_PAGE_SIZE): T[] {
  const p = clampPage(page, items.length, size);
  return items.slice((p - 1) * size, p * size);
}

export function pageRange(page: number, total: number, size = CUSTOMER_PAGE_SIZE): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const p = clampPage(page, total, size);
  return { from: (p - 1) * size + 1, to: Math.min(p * size, total) };
}

/** Up to `max` page numbers centred on the current page. */
export function visiblePages(page: number, total: number, size = CUSTOMER_PAGE_SIZE, max = 5): number[] {
  const pages = pageCount(total, size);
  if (pages === 0) return [];
  const p = clampPage(page, total, size);
  let start = Math.max(1, p - Math.floor(max / 2));
  const end = Math.min(pages, start + max - 1);
  start = Math.max(1, end - max + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/** Page (1-based) that contains the item with this id, or null. */
export function pageOfId(items: { id: string }[], id: string, size = CUSTOMER_PAGE_SIZE): number | null {
  const i = items.findIndex((c) => c.id === id);
  return i < 0 ? null : Math.floor(i / size) + 1;
}
