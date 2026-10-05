import {
  DeleteOrganizationRequestSchema,
  DepartmentListRequestSchema,
  DepartmentPageSchema,
  DepartmentSchema,
  PostListRequestSchema,
  PostPageSchema,
  PostSchema,
  SaveDepartmentRequestSchema,
  SavePostRequestSchema,
  type Department,
  type DepartmentPage,
  type Post,
  type PostPage
} from "@template/contracts/organization";
import { getSupabaseClient } from "@/lib/supabase/client";

type DatabaseRow = Record<string, unknown>;
type OrganizationKind = "department" | "post";

function fail(message: string): Error {
  return new Error(message);
}

function throwDatabaseError(
  error: { code?: string; message?: string } | null,
  fallback: string,
  kind: OrganizationKind
): void {
  if (!error) return;
  if (error.code === "23505") {
    throw fail(kind === "department" ? "部门编码已存在" : "岗位编码已存在");
  }
  if (error.code === "23503") {
    throw fail(kind === "department" ? "部门已被用户引用，不能删除" : "岗位已被用户引用，不能删除");
  }
  if (error.code === "42501") {
    throw fail("当前账号没有执行此操作的权限");
  }
  throw fail(error.message || fallback);
}

export function mapDepartmentRow(value: unknown): Department {
  if (!value || typeof value !== "object") throw fail("部门数据格式无效");
  const row = value as DatabaseRow;
  return DepartmentSchema.parse({
    id: row.id,
    deptCode: row.dept_code,
    deptName: row.dept_name,
    status: row.status,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

export function mapPostRow(value: unknown): Post {
  if (!value || typeof value !== "object") throw fail("岗位数据格式无效");
  const row = value as DatabaseRow;
  return PostSchema.parse({
    id: row.id,
    postCode: row.post_code,
    postName: row.post_name,
    status: row.status,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function getDepartments(input: unknown = {}): Promise<DepartmentPage> {
  const request = DepartmentListRequestSchema.parse(input);
  const client = getSupabaseClient();
  let query = client
    .from("department_read_model")
    .select("id, dept_code, dept_name, status, description, created_at, updated_at", {
      count: "exact"
    });
  if (request.deptCode) query = query.ilike("dept_code", `%${escapeLike(request.deptCode)}%`);
  if (request.deptName) query = query.ilike("dept_name", `%${escapeLike(request.deptName)}%`);
  if (request.status !== undefined) query = query.eq("status", request.status);

  const from = (request.page - 1) * request.pageSize;
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(from, from + request.pageSize - 1);
  throwDatabaseError(error, "部门列表加载失败", "department");
  return DepartmentPageSchema.parse({
    items: (data ?? []).map(mapDepartmentRow),
    total: count ?? 0,
    page: request.page,
    pageSize: request.pageSize
  });
}

export async function getPosts(input: unknown = {}): Promise<PostPage> {
  const request = PostListRequestSchema.parse(input);
  const client = getSupabaseClient();
  let query = client
    .from("post_read_model")
    .select("id, post_code, post_name, status, description, created_at, updated_at", {
      count: "exact"
    });
  if (request.postCode) query = query.ilike("post_code", `%${escapeLike(request.postCode)}%`);
  if (request.postName) query = query.ilike("post_name", `%${escapeLike(request.postName)}%`);
  if (request.status !== undefined) query = query.eq("status", request.status);

  const from = (request.page - 1) * request.pageSize;
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(from, from + request.pageSize - 1);
  throwDatabaseError(error, "岗位列表加载失败", "post");
  return PostPageSchema.parse({
    items: (data ?? []).map(mapPostRow),
    total: count ?? 0,
    page: request.page,
    pageSize: request.pageSize
  });
}

/** Lists every non-deleted department for selectors without converting IDs to Number. */
export async function listDepartmentOptions(): Promise<Department[]> {
  const items: Department[] = [];
  let page = 1;
  let total: number;
  do {
    const result = await getDepartments({ page, pageSize: 100 });
    items.push(...result.items);
    total = result.total;
    page += 1;
    if (result.items.length === 0) break;
  } while (items.length < total);
  return items;
}

/** Lists every non-deleted post for selectors without converting IDs to Number. */
export async function listPostOptions(): Promise<Post[]> {
  const items: Post[] = [];
  let page = 1;
  let total: number;
  do {
    const result = await getPosts({ page, pageSize: 100 });
    items.push(...result.items);
    total = result.total;
    page += 1;
    if (result.items.length === 0) break;
  } while (items.length < total);
  return items;
}

async function getDepartmentByCode(code: string): Promise<Department> {
  const { data, error } = await getSupabaseClient()
    .from("department_read_model")
    .select("id, dept_code, dept_name, status, description, created_at, updated_at")
    .eq("dept_code", code)
    .maybeSingle();
  throwDatabaseError(error, "保存后的部门读取失败", "department");
  if (!data) throw fail("保存后的部门不存在或当前账号无读取权限");
  return mapDepartmentRow(data);
}

async function getPostByCode(code: string): Promise<Post> {
  const { data, error } = await getSupabaseClient()
    .from("post_read_model")
    .select("id, post_code, post_name, status, description, created_at, updated_at")
    .eq("post_code", code)
    .maybeSingle();
  throwDatabaseError(error, "保存后的岗位读取失败", "post");
  if (!data) throw fail("保存后的岗位不存在或当前账号无读取权限");
  return mapPostRow(data);
}

export async function saveDepartment(input: unknown): Promise<Department> {
  const request = SaveDepartmentRequestSchema.parse(input);
  const client = getSupabaseClient();
  const values = {
    dept_code: request.deptCode,
    dept_name: request.deptName,
    status: request.status,
    description: request.description
  };
  let code: string | undefined;
  if (request.id) {
    const { data, count, error } = await client
      .from("departments")
      .update(values, { count: "exact" })
      .eq("id", request.id)
      .select("dept_code")
      .maybeSingle();
    throwDatabaseError(error, "部门保存失败", "department");
    if (!data || count === 0) throw fail("部门不存在或当前账号无更新权限");
    code = data.dept_code;
  } else {
    const { data, error } = await client
      .from("departments")
      .insert(values)
      .select("dept_code")
      .single();
    throwDatabaseError(error, "部门创建失败", "department");
    code = data.dept_code;
  }
  return getDepartmentByCode(code);
}

export async function savePost(input: unknown): Promise<Post> {
  const request = SavePostRequestSchema.parse(input);
  const client = getSupabaseClient();
  const values = {
    post_code: request.postCode,
    post_name: request.postName,
    status: request.status,
    description: request.description
  };
  let code: string | undefined;
  if (request.id) {
    const { data, count, error } = await client
      .from("posts")
      .update(values, { count: "exact" })
      .eq("id", request.id)
      .select("post_code")
      .maybeSingle();
    throwDatabaseError(error, "岗位保存失败", "post");
    if (!data || count === 0) throw fail("岗位不存在或当前账号无更新权限");
    code = data.post_code;
  } else {
    const { data, error } = await client
      .from("posts")
      .insert(values)
      .select("post_code")
      .single();
    throwDatabaseError(error, "岗位创建失败", "post");
    code = data.post_code;
  }
  return getPostByCode(code);
}

export async function deleteDepartment(idInput: unknown): Promise<void> {
  const { id } = DeleteOrganizationRequestSchema.parse({ id: idInput });
  const { error } = await getSupabaseClient().rpc("delete_department", {
    p_department_id: id
  });
  throwDatabaseError(error, "部门删除失败", "department");
}

export async function deletePost(idInput: unknown): Promise<void> {
  const { id } = DeleteOrganizationRequestSchema.parse({ id: idInput });
  const { error } = await getSupabaseClient().rpc("delete_post", {
    p_post_id: id
  });
  throwDatabaseError(error, "岗位删除失败", "post");
}
