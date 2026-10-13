import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const DB_URL =
	process.env.DATABASE_URL ??
	"postgresql://facilities:facilities@localhost:5432/facilities";

describe("app", () => {
	let app: FastifyInstance;

	before(async () => {
		app = await buildApp(
			loadConfig({
				DATABASE_URL: DB_URL,
				REDIS_URL: REDIS_URL,
				RATE_LIMIT_NAMESPACE: randomUUID(),
				NODE_ENV: "test",
				JWT_SECRET: "test-secret-that-is-at-least-32-chars",
				// Generous: these suites exercise behaviour, not throttling.
				RATE_LIMIT_MAX: "10000",
				RATE_LIMIT_LOGIN_MAX: "10000",
				RATE_LIMIT_REGISTER_MAX: "10000",
			}),
		);
		await app.ready();
	});

	after(async () => {
		await app.close();
	});

	test("GET /health reports ok", async () => {
		const response = await app.inject({ method: "GET", url: "/health" });

		assert.equal(response.statusCode, 200);
		const body = response.json<{ status: string; uptime: number }>();
		assert.equal(body.status, "ok");
		assert.ok(body.uptime > 0);
	});

	test("unknown route returns a structured 404", async () => {
		const response = await app.inject({ method: "GET", url: "/nope" });

		assert.equal(response.statusCode, 404);
		assert.partialDeepStrictEqual(response.json(), {
			error: "Not Found",
			statusCode: 404,
		});
	});

	test("a thrown error becomes an opaque 500", async () => {
		const scratch = await buildApp(
			loadConfig({
				DATABASE_URL: DB_URL,
				REDIS_URL: REDIS_URL,
				RATE_LIMIT_NAMESPACE: randomUUID(),
				NODE_ENV: "test",
				JWT_SECRET: "test-secret-that-is-at-least-32-chars",
				RATE_LIMIT_MAX: "10000",
			}),
		);
		scratch.get("/boom", { config: { public: true } }, async () => {
			throw new Error(
				"PG connect ECONNREFUSED postgres://facilities:facilities@localhost:5432/facilities",
			);
		});
		await scratch.ready();

		const res = await scratch.inject({ method: "GET", url: "/boom" });
		await scratch.close();

		assert.equal(res.statusCode, 500);
		assert.ok(
			!res.body.includes("facilities:facilities"),
			"the connection string must never reach the client",
		);
		assert.ok(!res.body.includes("ECONNREFUSED"));
		assert.deepEqual(res.json(), {
			error: "Internal Server Error",
			message: "An unexpected error occurred",
			statusCode: 500,
		});
	});

	test("a validation failure keeps its message and the error contract", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/auth/register",
			payload: {
				email: "not-an-email",
				password: "a-sufficiently-long-password",
			},
		});

		assert.equal(res.statusCode, 400);
		const body = res.json<Record<string, unknown>>();
		assert.deepEqual(Object.keys(body).sort(), [
			"error",
			"message",
			"statusCode",
		]);
		assert.equal(body.error, "Bad Request");
		assert.match(String(body.message), /email/i);
	});
});
