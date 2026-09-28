import config from "../config";
import * as winston from "winston";

const SENSITIVE_KEYS = [
  "password",
  "password_hash",
  "accessToken",
  "refreshToken",
  "authorization",
  "token",
];

function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(maskSensitive);
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      next[key] = SENSITIVE_KEYS.some(
        (sensitiveKey) => sensitiveKey.toLowerCase() === key.toLowerCase()
      )
        ? "***"
        : maskSensitive(nestedValue);
    }
    return next;
  }

  return value;
}

const transports = [];
if (process.env.NODE_ENV !== "development") {
  transports.push(new winston.transports.Console());
} else {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.cli(),
        winston.format.splat()
      ),
    })
  );
}

const LoggerInstance = winston.createLogger({
  level: config.logs.level,
  levels: winston.config.npm.levels,
  format: winston.format.combine(
    winston.format((info) => maskSensitive(info) as winston.Logform.TransformableInfo)(),
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss",
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports,
});

export default LoggerInstance;
