import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.ts";
import { httpError } from "../lib/http-error.ts";

/**
 * Per-user limits only; per-IP and volumetric limiting belong at the edge.
 * See "Rate limiting" in README.md for the reasoning and its consequences.
 */
export async function setupRateLimit(
	app: FastifyInstance,
	config: Config,
): Promise<void> {
	await app.register(rateLimit, {
		global: true,
		...config.rateLimit.global,
		redis: app.redis,
		nameSpace: config.rateLimit.nameSpace,

		// After authentication, so `request.user` comes from a verified token.
		// Keying on an unverified `sub` would let an attacker forge a victim's id
		// and exhaust their budget.
		hook: "preHandler",

		// Login and register have no user yet; the socket address is the only
		// identifier a caller cannot assert for itself.
		keyGenerator: (request: FastifyRequest) => request.user?.sub ?? request.ip,

		// Losing Redis should not become an outage of its own.
		skipOnError: true,

		errorResponseBuilder: (_request, context) =>
			httpError(429, `Rate limit exceeded. Retry in ${context.after}.`),
	});
}
