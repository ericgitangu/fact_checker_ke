import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@fact-checker-ke/core";
import type { AuthService, SessionUser } from "./service.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: SessionUser;
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

/**
 * ADR-0020 §4: Fastify preHandler guarding editor/admin/moderator
 * routes. `allowedRoles` omitted means "any authenticated role is
 * enough" (used for routes shared across roles, none currently). A
 * session with role=null (registered but ungranted, AT-0020-3) is
 * authenticated but authorized for nothing role-gated.
 */
export function requireRole(auth: AuthService, allowedRoles: readonly Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = bearerToken(request);
    if (!token) {
      await reply.status(401).send({ error: "unauthorized", message: "Missing bearer session token." });
      return;
    }
    const result = await auth.verifySession(token);
    if (!result.ok) {
      await reply.status(401).send({ error: "unauthorized", message: result.error.message });
      return;
    }
    if (!result.value.role || !allowedRoles.includes(result.value.role)) {
      await reply.status(403).send({ error: "forbidden", message: "Account role does not permit this action." });
      return;
    }
    request.authUser = result.value;
  };
}
