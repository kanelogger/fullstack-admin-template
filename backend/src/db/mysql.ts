import {
  createPool,
  type ExecuteValues,
  type PoolOptions,
  type Pool,
  type PoolConnection,
} from "mysql2/promise";
import config from "../config";
import Logger from "../loaders/logger";

export const pool: Pool = createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  charset: config.mysql.charset,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
} as PoolOptions);

export type QueryParams = ExecuteValues;

export async function query<T = unknown>(
  sql: string,
  params: QueryParams = []
): Promise<T[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

export async function withTransaction<T>(
  handler: (connection: PoolConnection) => Promise<T>
): Promise<T> {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function assertMysqlConnection(): Promise<void> {
  await pool.query("SELECT 1");
  Logger.info("MySQL 连接检查通过");
}
