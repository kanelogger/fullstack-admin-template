import * as dotenv from "dotenv";

process.env.NODE_ENV = process.env.NODE_ENV || "development";

const envFound = dotenv.config();
if (envFound.error) {
  throw new Error("⚠️  Couldn't find .env file  ⚠️");
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`⚠️  Missing required env var: ${key}  ⚠️`);
  }
  return value;
}

export default {
  port: parseInt(requireEnv("PORT"), 10),
  jwtSecret: requireEnv("JWT_SECRET"),
  accessTokenTtlMinutes: parseInt(
    process.env.ACCESS_TOKEN_TTL_MINUTES || "30",
    10
  ),
  refreshTokenTtlDays: parseInt(
    process.env.REFRESH_TOKEN_TTL_DAYS || "7",
    10
  ),
  logs: {
    level: process.env.LOG_LEVEL || "debug",
  },
  mysql: {
    host: process.env.MYSQL_HOST || "localhost",
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "123456789",
    database: process.env.MYSQL_DATABASE || "admin_template",
    charset: "utf8mb4_unicode_ci",
  },
};
