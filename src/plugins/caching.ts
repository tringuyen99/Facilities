import etag from "@fastify/etag";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
	interface FastifyContextConfig {
		/** Opt a route into client caching: `config: { cache: { maxAge: 300 } }`. */
		cache?: { maxAge: number };
	}
}

/**
 * Opt-in per route: anything that does not ask for caching gets `no-store`, so
 * forgetting costs an optimisation rather than serving stale responses.
 * See "Caching" in README.md.
 */
export async function setupCaching(app: FastifyInstance): Promise<void> {
	await app.register(etag, { replyWith304: true });

	app.addHook("onSend", async (request, reply, payload) => {
		const cache =
			reply.statusCode < 400 ? request.routeOptions.config.cache : undefined;

		if (cache === undefined) {
			reply.header("cache-control", "no-store");
			return payload;
		}

		// `private` because these endpoints are authenticated;
		reply.header("cache-control", `private, max-age=${cache.maxAge}`);

		// A private cache keys on method and URL alone, so without this a browser
		// serves one session's body to the next after a logout or account switch.
		reply.header("vary", "Authorization");

		return payload;
	});
}
