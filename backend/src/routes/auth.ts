import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createMathExpr } from "svg-captcha";
import { AppError } from "../utils/errors";
import { sendSuccess } from "../utils/response";
import { login, refreshAccessToken } from "../services/auth";
import { getUserProfile } from "../services/users";
import { getMenuRoutesByUserId } from "../services/menus";

interface LoginBody {
  username: string;
  password: string;
  rememberMe?: boolean;
}

interface RefreshBody {
  refreshToken?: string;
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/login",
    async (
      request: FastifyRequest<{ Body: LoginBody }>,
      reply: FastifyReply
    ) => {
      const { username, password } = request.body || {};
      if (!username || !password) {
        throw new AppError("BAD_REQUEST", "用户名和密码不能为空");
      }

      const result = await login(
        { username, password },
        {
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        }
      );

      return reply.send(sendSuccess(result));
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
