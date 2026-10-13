import { once } from "node:events";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import {
	serializerCompiler,
	validatorCompiler,
} from "fastify-type-provider-zod";
import type { Redis } from "ioredis";
import { createPrismaClient } from "./clients/db.ts";
import { closeRedisClient, createRedisClient } from "./clients/redis.ts";
import { type Config, loadConfig } from "./config.ts";
import type { PrismaClient } from "./generated/prisma/client.ts";
import { httpError } from "./lib/http-error.ts";
import { setupAuth } from "./plugins/auth.ts";
import { setupCaching } from "./plugins/caching.ts";
import { setupRateLimit } from "./plugins/rate-limit.ts";
import { setupSwagger } from "./plugins/swagger.ts";
import { authRoutes } from "./routes/auth.ts";
import { facilityRoutes } from "./routes/facilities.ts";
import { healthRoutes } from "./routes/health.ts";

/// TODO: this should live in config dummyy
const REDIS_CONNECT_TIMEOUT_MS = 2000;

export async function buildApp(
	config: Config = loadConfig(),
): Promise<FastifyInstance> {
	const app = Fastify({
		logger: { level: config.logLevel },
	});

	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);

	app.decorate("config", config);

	const prisma = createPrismaClient(config.databaseUrl);
	app.decorate("prisma", prisma);
	app.addHook("onClose", async () => {
		await prisma.$disconnect();
	});

	const redis = createRedisClient(config.redisUrl, app.log);
	app.decorate("redis", redis);
	app.addHook("onClose", () => closeRedisClient(redis));

	// Ugly as hell but running out of time.
	if (redis.status !== "ready") {
		await once(redis, "ready", {
			signal: AbortSignal.timeout(REDIS_CONNECT_TIMEOUT_MS),
		}).catch((error: unknown) => {
			app.log.error(
				{ err: error },
				"redis not ready at startup — rate limiting is degraded",
			);
		});
	}

	await setupSwagger(app);

	await setupAuth(app, config);
	await setupRateLimit(app, config);
	await setupCaching(app);

	await app.register(healthRoutes);
	await app.register(authRoutes);
	await app.register(facilityRoutes);

	app.setNotFoundHandler((request, reply) => {
		reply
			.status(404)
			.send(
				httpError(404, `Route ${request.method} ${request.url} does not exist`),
			);
	});

	// Fastify's default serialises error.message to the client, which will leak sensitive information such as the connection string.
	app.setErrorHandler((error: FastifyError, request, reply) => {
		const statusCode = error.statusCode ?? 500;

		if (statusCode >= 500) {
			request.log.error({ err: error }, "request failed");
			return reply
				.status(500)
				.send(httpError(500, "An unexpected error occurred"));
		}

		// 4xx messages come from our own schemas, so they disclose nothing internal.
		request.log.warn({ err: error }, "request rejected");
		return reply.status(statusCode).send(httpError(statusCode, error.message));
	});

	return app;
}

declare module "fastify" {
	interface FastifyInstance {
		config: Config;
		prisma: PrismaClient;
		redis: Redis;
	}
}
