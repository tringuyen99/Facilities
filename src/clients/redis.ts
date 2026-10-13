import type { FastifyBaseLogger } from "fastify";
import { Redis } from "ioredis";

export function createRedisClient(url: string, log: FastifyBaseLogger): Redis {
	const client = new Redis(url, {
		// Rate limiting fails open, so a slow Redis must not hold requests queued.

		/// TODO: put this in config maybe dummmy
		connectTimeout: 500,
		maxRetriesPerRequest: 3,
		enableOfflineQueue: false,
		lazyConnect: false,
	});

	client.on("error", (error: Error) => {
		log.error({ err: error }, "redis unavailable, requests still served");
	});

	return client;
}

/** `quit()` rejects once the socket is gone, and nothing pending needs flushing. */
export async function closeRedisClient(client: Redis): Promise<void> {
	await client.quit().catch(() => client.disconnect());
}
