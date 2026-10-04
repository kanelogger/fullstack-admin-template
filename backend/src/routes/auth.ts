import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createMathExpr } from "svg-captcha";
import { AppError } from "../utils/errors";
import { sendSuccess } from "../utils/response";
import { exchangeSupabaseSession, refreshAccessToken } from "../services/auth";
import { getUserProfile } from "../services/users";
import { getMenuRoutesByUserId } from "../services/menus";

interface RefreshBody {
  refreshToken?: string;
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  // Password verification now lives in the Supabase Edge Function. Retain the
  // path temporarily so old clients receive an explicit migration response.
  app.post("/login", async (_request: FastifyRequest, _reply: FastifyReply) => {
    throw new AppError("FORBIDDEN", "账号密码登录已迁移至 Supabase Auth");
  });

  app.post(
    "/session/legacy-token",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authorization = request.headers.authorization ?? "";
      if (!authorization.startsWith("Bearer ")) {
        throw new AppError("UNAUTHORIZED", "缺少 Supabase 访问令牌");
      }

      const tokens = await exchangeSupabaseSession(
        authorization.slice("Bearer ".length)
      );
      return reply.send(sendSuccess(tokens));
    }
  );

  app.post(
    "/refresh-token",
    async (
      request: FastifyRequest<{ Body: RefreshBody }>,
      reply: FastifyReply
    ) => {
      const { refreshToken } = request.body || {};
      if (!refreshToken) {
        throw new AppError("UNAUTHORIZED", "缺少刷新令牌");
      }

      const result = await refreshAccessToken(refreshToken);
      return reply.send(sendSuccess(result));
    }
  );

  app.post("/logout", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(sendSuccess({ message: "退出成功" }));
  });

  app.get("/auth/me", async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user?.userId;
    if (!userId) {
      throw new AppError("UNAUTHORIZED", "未登录");
    }

    const [user, menus] = await Promise.all([
      getUserProfile(userId),
      getMenuRoutesByUserId(userId),
    ]);

    if (!user) {
      throw new AppError("NOT_FOUND", "当前用户不存在");
    }

    return reply.send(
      sendSuccess({
        user,
        roles: user.roles,
        menus,
        permissions: [],
      })
    );
  });

  app.get("/captcha", async (_request: FastifyRequest, reply: FastifyReply) => {
    const create = createMathExpr({
      mathMin: 1,
      mathMax: 4,
      mathOperator: "+",
    });

    return reply
      .header("Content-Type", "application/json; charset=utf-8")
      .send(sendSuccess({ text: create.text, svg: create.data }));
  });
}
