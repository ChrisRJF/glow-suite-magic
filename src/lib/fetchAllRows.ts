// The backend returns at most 1000 rows per request. This helper pages through
// every row with a stable order (requested column, then id) so nothing is cut off.
export const PAGE_SIZE = 1000;

type PageResult = { data: any[] | null; error: any };

export async function fetchAllRows(
  buildPage: (from: number, to: number) => PromiseLike<PageResult>,
  pageSize = PAGE_SIZE,
  maxPages = 1000,
): Promise<{ data: any[]; error: any }> {
  const all: any[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) return { data: all, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return { data: all, error: null };
}
