export interface PageQuery {
  page?: number;
  limit?: number;
}

export function pageWindow(query: PageQuery) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const from = (page - 1) * limit;
  return { page, limit, from, to: from + limit - 1 };
}

export function pageOf<T>(data: T[] | null, total: number | null, page: number, limit: number) {
  return {
    data: data ?? [],
    page,
    limit,
    total: total ?? data?.length ?? 0,
  };
}
