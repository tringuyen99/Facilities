import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.ts";
import { httpError } from "../lib/http-error.ts";

declare module "@fastify/jwt" {
	interface FastifyJWT {
		payload: { sub: string; email: string };
		user: { sub: string; email: string };
	}
}

declare module "fastify" {
	interface FastifyContextConfig {
		/** Opt a route out of authentication: `config: { public: true }`. */
		public?: boolean;
	}
}

/** Matches the scheme registered in plugins/swagger.ts. */
const BEARER: Array<Record<string, string[]>> = [{ bearerAuth: [] }];

function isPublic(request: FastifyRequest): boolean {
	// No matched route: let the not-found handler answer.
	if (request.routeOptions.url === undefined) {
		return true;
	}

	return request.routeOptions.config.public === true;
}

/**
 * Default deny: a route opts out with `config: { public: true }`
 */
export async function setupAuth(
	app: FastifyInstance,
	config: Config,
): Promise<void> {
	await app.register(jwt, {
		secret: config.jwtSecret,
		sign: { expiresIn: config.jwtTtl },
	});

	app.addHook("onRoute", (routeOptions) => {
		if (routeOptions.config?.public !== true) {
			routeOptions.schema = { ...routeOptions.schema, security: BEARER };
		}
	});

	// onRequest: rejected before body parsing or any database work.
	app.addHook(
		"onRequest",
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (isPublic(request)) {
				return;
			}

			try {
				await request.jwtVerify();
			} catch {
				await reply
					.status(401)
					.send(httpError(401, "A valid Bearer token is required"));
			}
		},
	);
}
