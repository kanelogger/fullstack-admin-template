import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { AppError } from "../utils/errors";
import { sendSuccess } from "../utils/response";
import { getMenuRoutesByUserId } from "../services/menus";

export default async function asyncRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/get-async-routes",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new AppError("UNAUTHORIZED", "未登录");
      }

      const menus = await getMenuRoutesByUserId(userId);
      return reply.send(sendSuccess(menus));
    }
  );
}
