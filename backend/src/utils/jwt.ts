import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import * as jwt from "jsonwebtoken";
import config from "../config";
import { sendError } from "./response";

export interface JwtPayload {
  userId: number;
  username: string;
  type: "access" | "refresh";
}

export const WHITELIST = ["/login", "/refresh-token", "/captcha"];

export function signAccessToken(payload: Omit<JwtPayload, "type">): string {
  return jwt.sign(
    { ...payload, type: "access" },
    config.jwtSecret,
    { expiresIn: `${config.accessTokenTtlMinutes}m` }
  );
}

export function signRefreshToken(payload: Omit<JwtPayload, "type">): string {
  return jwt.sign(
    { ...payload, type: "refresh" },
    config.jwtSecret,
    { expiresIn: `${config.refreshTokenTtlDays}d` }
  );
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}

export function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  const path = request.url.split("?")[0];
  if (WHITELIST.includes(path)) {
    return done();
  }

  const authHeader = request.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    reply.code(401).send(sendError("UNAUTHORIZED", "缺少访问令牌"));
    return;
  }

  const token = authHeader.slice("Bearer ".length);
  try {
    const payload = verifyToken(token);
    if (payload.type !== "access") {
      reply.code(401).send(sendError("UNAUTHORIZED", "令牌类型无效"));
      return;
    }
    request.user = payload;
    done();
  } catch (error) {
    const message =
      error instanceof jwt.TokenExpiredError
        ? "访问令牌已过期"
        : "访问令牌无效";
    reply.code(401).send(sendError("UNAUTHORIZED", message));
  }
}

declare module "fastify" {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}
