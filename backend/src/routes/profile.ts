import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../utils/errors";
import { sendSuccess } from "../utils/response";
import {
  changeCurrentPassword,
  getUserProfile,
  updateCurrentProfile,
} from "../services/users";
import { recordOperationLog } from "../services/operation-logs";

function currentUserId(request: FastifyRequest): number {
  const userId = request.user?.userId;
  if (!userId) throw new AppError("UNAUTHORIZED", "未登录");
  return userId;
}

async function record(
  request: FastifyRequest,
  operationType: string,
  requestParams?: unknown
) {
  await recordOperationLog({
    operatorId: request.user?.userId ?? null,
    moduleCode: "PROFILE",
    operationType,
    requestMethod: request.method,
    requestPath: request.url,
    requestParams,
  });
}

export default async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/profile", async (request: FastifyRequest, reply: FastifyReply) => {
    const profile = await getUserProfile(currentUserId(request));
    if (!profile) throw new AppError("NOT_FOUND", "当前用户不存在");
    return reply.send(sendSuccess(profile));
  });

  app.patch("/profile", async (request: FastifyRequest, reply: FastifyReply) => {
    const profile = await updateCurrentProfile(currentUserId(request), request.body);
    await record(request, "UPDATE", request.body);
    return reply.send(sendSuccess(profile));
  });

  app.post(
    "/profile/change-password",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await changeCurrentPassword(
        currentUserId(request),
        request.body
      );
      await record(request, "CHANGE_PASSWORD", request.body);
      return reply.send(sendSuccess(result));
    }
  );
}
