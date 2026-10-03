import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RoleSchema } from "@fact-checker-ke/core";
import { AuthService } from "../lib/auth/service.js";
import { requireRole } from "../lib/auth/middleware.js";

const RegisterBodySchema = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });
const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  totpCode: z.string().length(6).optional(),
});
const VerifyTotpBodySchema = z.object({ code: z.string().length(6) });
const GrantRoleBodySchema = z.object({ userId: z.string().uuid(), role: RoleSchema });

/**
 * ADR-0020 §4 self-hosted identity routes. Mounted unauthenticated
 * (register/login/bootstrap) except where `requireRole` gates them.
 * Session token travels as `Authorization: Bearer <token>` — a plain
 * header rather than a cookie, since mobile talks to this API directly
 * (ADR-0015) and a cookie-only scheme would need a separate mobile path.
 */
export async function authRoutes(app: FastifyInstance, deps: { auth: AuthService }): Promise<void> {
  const { auth } = deps;

  app.post("/v1/auth/register", async (request, reply) => {
    const parsed = RegisterBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });

    const result = await auth.register(parsed.data.email, parsed.data.password);
    if (!result.ok) return reply.status(409).send({ error: result.error.kind, message: result.error.message });
    return reply.status(201).send(result.value);
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const parsed = LoginBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });

    const result = await auth.login(parsed.data.email, parsed.data.password, parsed.data.totpCode ?? null);
    if (!result.ok) return reply.status(401).send({ error: result.error.kind, message: result.error.message });
    return reply.status(200).send({ token: result.value.token, user: result.value.user });
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const header = request.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      await auth.logout(header.slice("Bearer ".length).trim());
    }
    return reply.status(204).send();
  });

  // TOTP enrollment itself requires only a valid session (any role,
  // including role=null) -- a newly registered editor-to-be must be
  // able to enroll BEFORE any role is granted (AT-0020-3's ordering).
  app.post<{ Params: { userId: string } }>("/v1/auth/users/:userId/totp/enroll", async (request, reply) => {
    const token = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice("Bearer ".length).trim()
      : null;
    if (!token) return reply.status(401).send({ error: "unauthorized" });
    const session = await auth.verifySession(token);
    if (!session.ok || session.value.id !== request.params.userId) {
      return reply.status(403).send({ error: "forbidden", message: "Can only enroll your own account." });
    }
    const result = await auth.enrollTotp(request.params.userId);
    if (!result.ok) return reply.status(404).send({ error: result.error.kind, message: result.error.message });
    return reply.status(200).send(result.value);
  });

  app.post<{ Params: { userId: string } }>("/v1/auth/users/:userId/totp/verify", async (request, reply) => {
    const parsed = VerifyTotpBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    const result = await auth.verifyTotpEnrollment(request.params.userId, parsed.data.code);
    if (!result.ok) return reply.status(400).send({ error: result.error.kind, message: result.error.message });
    return reply.status(200).send(result.value);
  });

  // Role grants: either a real admin's authenticated request, or the
  // one-time bootstrap path (see AuthService.grantRole's docblock) --
  // bootstrap is identified by the ABSENCE of a bearer token, never by
  // a flag a caller could forge.
  app.post("/v1/auth/roles/grant", async (request, reply) => {
    const parsed = GrantRoleBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });

    const header = request.headers.authorization;
    let actor: { id: string; role: import("@fact-checker-ke/core").Role | null } | null = null;
    if (header?.startsWith("Bearer ")) {
      const session = await auth.verifySession(header.slice("Bearer ".length).trim());
      if (!session.ok) return reply.status(401).send({ error: "unauthorized" });
      actor = { id: session.value.id, role: session.value.role };
    }

    const result = await auth.grantRole(actor, parsed.data.userId, parsed.data.role);
    if (!result.ok) {
      const status = result.error.kind === "mfa_required" || result.error.kind === "forbidden" ? 403 : 404;
      return reply.status(status).send({ error: result.error.kind, message: result.error.message });
    }
    return reply.status(200).send(result.value);
  });

  // Smoke route for requireRole's own test coverage -- not an ADR
  // requirement on its own, but every other role-gated route in
  // routes/editor.ts and routes/comments.ts reuses this exact
  // middleware, so it's exercised there too.
  app.get("/v1/auth/whoami", { preHandler: requireRole(auth, ["editor", "admin", "moderator"]) }, async (request, reply) => {
    return reply.status(200).send(request.authUser);
  });
}
