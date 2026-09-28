import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { pool, withTransaction } from "../db/mysql";
import { AppError } from "../utils/errors";
import {
  buildLimitClause,
  buildPaginatedResult,
  parsePaginationParams,
} from "../utils/pagination";
import { hashPassword } from "../utils/password";
import { getUserRoles, type RoleSummary, type UserRow } from "./users";

type Query = Record<string, unknown>;
type Body = Record<string, unknown>;
type SqlParam = string | number | null;
type SqlParams = SqlParam[];

interface CountRow {
  total: number;
}

interface UserListRow extends UserRow {
  dept_name: string | null;
  post_name: string | null;
}

export interface UserListItem {
  id: number;
  userCode: string;
  username: string;
  nickname: string;
  phone: string | null;
  email: string | null;
  deptId: number | null;
  deptName: string | null;
  postId: number | null;
  postName: string | null;
  status: number;
  roles: RoleSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface OptionItem {
  id: number;
  label: string;
  value: number;
  status: number;
}

function stringValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function requiredString(body: Body, key: string, label: string): string {
  const value = stringValue(body[key]);
  if (!value) throw new AppError("VALIDATION_ERROR", `${label}不能为空`);
  return value;
}

function requiredNumber(body: Body, key: string, label: string): number {
  const value = Number(body[key]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError("VALIDATION_ERROR", `${label}不能为空`);
  }
  return value;
}

function statusValue(value: unknown): number {
  const status = Number(value);
  return status === 0 ? 0 : 1;
}

function bodyOf(input: unknown): Body {
  return input && typeof input === "object" ? (input as Body) : {};
}

function roleIdsOf(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

async function execute(
  sql: string,
  params: SqlParams = []
): Promise<ResultSetHeader> {
  const [result] = await pool.execute(sql, params);
  return result as ResultSetHeader;
}

async function executeWithConnection(
  connection: PoolConnection,
  sql: string,
  params: SqlParams = []
): Promise<ResultSetHeader> {
  const [result] = await connection.execute(sql, params);
  return result as ResultSetHeader;
}

async function list<T>(sql: string, params: SqlParams = []): Promise<T[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

async function first<T>(sql: string, params: SqlParams = []): Promise<T | null> {
  const rows = await list<T>(sql, params);
  return rows[0] ?? null;
}

async function count(sql: string, params: SqlParams = []): Promise<number> {
  const row = await first<CountRow>(sql, params);
  return Number(row?.total ?? 0);
}

function assertAffected(result: ResultSetHeader, message: string): void {
  if (result.affectedRows === 0) throw new AppError("NOT_FOUND", message);
}

function handleDuplicate(error: unknown): never {
  if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
    throw new AppError("CONFLICT", "用户工号或登录名已存在");
  }
  throw error;
}

function buildUserFilter(query: Query): { where: string; params: SqlParams } {
  const conditions = ["u.deleted = 0"];
  const params: SqlParams = [];

  const likeFields: Array<[string, string]> = [
    ["userCode", "u.user_code"],
    ["username", "u.login_name"],
    ["nickname", "u.display_name"],
    ["phone", "u.phone"],
  ];

  for (const [key, column] of likeFields) {
    const value = stringValue(query[key]);
    if (!value) continue;
    conditions.push(`${column} LIKE ?`);
    params.push(`%${value}%`);
  }

  const eqFields: Array<[string, string]> = [
    ["deptId", "u.dept_id"],
    ["postId", "u.post_id"],
    ["status", "u.status"],
  ];

  for (const [key, column] of eqFields) {
    if (query[key] === undefined || query[key] === "") continue;
    conditions.push(`${column} = ?`);
    params.push(Number(query[key]));
  }

  return { where: conditions.join(" AND "), params };
}

async function mapUser(row: UserListRow): Promise<UserListItem> {
  return {
    id: row.id,
    userCode: row.user_code,
    username: row.login_name,
    nickname: row.display_name,
    phone: row.phone,
    email: row.email,
    deptId: row.dept_id,
    deptName: row.dept_name,
    postId: row.post_id,
    postName: row.post_name,
    status: row.status,
    roles: await getUserRoles(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function replaceUserRoles(
  connection: PoolConnection,
  userId: number,
  roleIds: number[],
  actorId: number | null
): Promise<void> {
  await executeWithConnection(
    connection,
    `UPDATE user_roles SET deleted = 1, updated_by = ? WHERE user_id = ?`,
    [actorId, userId]
  );

  for (const roleId of roleIds) {
    await executeWithConnection(
      connection,
      `INSERT INTO user_roles (user_id, role_id, created_by, updated_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE deleted = 0, updated_by = VALUES(updated_by)`,
      [userId, roleId, actorId, actorId]
    );
  }
}

export async function listUsers(query: Query) {
  const { page, pageSize } = parsePaginationParams(query);
  const { limit, offset } = buildLimitClause(page, pageSize);
  const { where, params } = buildUserFilter(query);

  const rows = await list<UserListRow>(
    `SELECT u.*, d.dept_name, p.post_name
     FROM users u
     LEFT JOIN departments d ON d.id = u.dept_id AND d.deleted = 0
     LEFT JOIN posts p ON p.id = u.post_id AND p.deleted = 0
     WHERE ${where}
     ORDER BY u.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const totalItems = await count(
    `SELECT COUNT(*) AS total FROM users u WHERE ${where}`,
    params
  );

  const items = await Promise.all(rows.map(mapUser));
  return buildPaginatedResult(items, totalItems, page, pageSize);
}

export async function getUserDetail(id: number): Promise<UserListItem> {
  const row = await first<UserListRow>(
    `SELECT u.*, d.dept_name, p.post_name
     FROM users u
     LEFT JOIN departments d ON d.id = u.dept_id AND d.deleted = 0
     LEFT JOIN posts p ON p.id = u.post_id AND p.deleted = 0
     WHERE u.id = ? AND u.deleted = 0
     LIMIT 1`,
    [id]
  );
  if (!row) throw new AppError("NOT_FOUND", "用户不存在");
  return mapUser(row);
}

export async function createManagedUser(
  input: unknown,
  actorId: number | null
): Promise<UserListItem> {
  const body = bodyOf(input);
  const roleIds = roleIdsOf(body.roleIds);
  if (roleIds.length === 0) {
    throw new AppError("VALIDATION_ERROR", "角色不能为空");
  }

  try {
    const id = await withTransaction(async (connection) => {
      const result = await executeWithConnection(
        connection,
        `INSERT INTO users
           (user_code, login_name, password_hash, display_name, phone, email,
            dept_id, post_id, status, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          requiredString(body, "userCode", "用户工号"),
          requiredString(body, "username", "登录名"),
          hashPassword(requiredString(body, "password", "初始密码")),
          requiredString(body, "nickname", "中文姓名"),
          stringValue(body.phone),
          stringValue(body.email),
          requiredNumber(body, "deptId", "部门"),
          requiredNumber(body, "postId", "岗位"),
          statusValue(body.status),
          actorId,
          actorId,
        ]
      );
      await replaceUserRoles(connection, result.insertId, roleIds, actorId);
      return result.insertId;
    });
    return getUserDetail(id);
  } catch (error) {
    handleDuplicate(error);
  }
}

export async function updateManagedUser(
  id: number,
  input: unknown,
  actorId: number | null
): Promise<UserListItem> {
  const body = bodyOf(input);
  const roleIds = roleIdsOf(body.roleIds);
  if (roleIds.length === 0) {
    throw new AppError("VALIDATION_ERROR", "角色不能为空");
  }

  try {
    await withTransaction(async (connection) => {
      assertAffected(
        await executeWithConnection(
          connection,
          `UPDATE users
           SET user_code = ?, login_name = ?, display_name = ?, phone = ?,
               email = ?, dept_id = ?, post_id = ?, status = ?, updated_by = ?
           WHERE id = ? AND deleted = 0`,
          [
            requiredString(body, "userCode", "用户工号"),
            requiredString(body, "username", "登录名"),
            requiredString(body, "nickname", "中文姓名"),
            stringValue(body.phone),
            stringValue(body.email),
            requiredNumber(body, "deptId", "部门"),
            requiredNumber(body, "postId", "岗位"),
            statusValue(body.status),
            actorId,
            id,
          ]
        ),
        "用户不存在"
      );
      await replaceUserRoles(connection, id, roleIds, actorId);
    });
    return getUserDetail(id);
  } catch (error) {
    handleDuplicate(error);
  }
}

export async function updateUserStatus(
  id: number,
  status: unknown,
  actorId: number | null
): Promise<UserListItem> {
  assertAffected(
    await execute(
      `UPDATE users SET status = ?, updated_by = ? WHERE id = ? AND deleted = 0`,
      [statusValue(status), actorId, id]
    ),
    "用户不存在"
  );
  return getUserDetail(id);
}

export async function resetUserPassword(
  id: number,
  input: unknown,
  actorId: number | null
): Promise<{ message: string }> {
  const body = bodyOf(input);
  const newPassword = requiredString(body, "newPassword", "新密码");

  assertAffected(
    await execute(
      `UPDATE users SET password_hash = ?, updated_by = ? WHERE id = ? AND deleted = 0`,
      [hashPassword(newPassword), actorId, id]
    ),
    "用户不存在"
  );

  return { message: "密码重置成功" };
}

export async function deleteManagedUser(
  id: number,
  actorId: number | null
): Promise<void> {
  assertAffected(
    await execute(
      `UPDATE users SET deleted = 1, updated_by = ? WHERE id = ? AND deleted = 0`,
      [actorId, id]
    ),
    "用户不存在"
  );
}

export async function listDepartmentOptions(): Promise<OptionItem[]> {
  return list<OptionItem>(
    `SELECT id, dept_name AS label, id AS value, status
     FROM departments
     WHERE deleted = 0 AND status = 1
     ORDER BY id ASC`
  );
}

export async function listPostOptions(): Promise<OptionItem[]> {
  return list<OptionItem>(
    `SELECT id, post_name AS label, id AS value, status
     FROM posts
     WHERE deleted = 0 AND status = 1
     ORDER BY id ASC`
  );
}

export async function listRoleOptions(): Promise<OptionItem[]> {
  return list<OptionItem>(
    `SELECT id, role_name AS label, id AS value, status
     FROM roles
     WHERE deleted = 0 AND status = 1
     ORDER BY id ASC`
  );
}
