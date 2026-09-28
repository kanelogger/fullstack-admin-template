/**
 * 分页参数解析与响应组装
 * 分页响应结构: { items: T[], pagination: { page, pageSize, totalItems, totalPages } }
 */
export interface PaginationParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export function parsePaginationParams(query: Record<string, unknown>): PaginationParams {
  let page = Number(query.page ?? DEFAULT_PAGE);
  let pageSize = Number(query.pageSize ?? DEFAULT_PAGE_SIZE);

  if (!Number.isInteger(page) || page < 1) {
    page = DEFAULT_PAGE;
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    pageSize = DEFAULT_PAGE_SIZE;
  }
  if (pageSize > MAX_PAGE_SIZE) {
    pageSize = MAX_PAGE_SIZE;
  }

  const sortBy = typeof query.sortBy === "string" ? query.sortBy : undefined;
  const sortOrder = query.sortOrder === "desc" ? "desc" : query.sortOrder === "asc" ? "asc" : undefined;

  return { page, pageSize, sortBy, sortOrder };
}

export function buildPaginatedResult<T>(
  items: T[],
  totalItems: number,
  page: number,
  pageSize: number
): PaginatedResult<T> {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return {
    items,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
    },
  };
}

export function buildLimitClause(page: number, pageSize: number): { limit: number; offset: number } {
  return {
    limit: pageSize,
    offset: pageSize * (page - 1),
  };
}

/**
 * 安全生成 ORDER BY 子句
 * 只允许白名单内的字段，避免 SQL 注入
 */
export function buildOrderByClause(
  sortBy: string | undefined,
  sortOrder: "asc" | "desc" | undefined,
  allowedColumns: string[],
  defaultColumn = "id"
): string {
  if (!sortBy || !allowedColumns.includes(sortBy)) {
    return `ORDER BY \`${defaultColumn}\` DESC`;
  }
  const direction = sortOrder === "asc" ? "ASC" : "DESC";
  return `ORDER BY \`${sortBy}\` ${direction}`;
}
