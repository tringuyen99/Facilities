import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { loadConfig } from "../config.ts";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const DB_URL =
	process.env.DATABASE_URL ??
	"postgresql://facilities:facilities@localhost:5432/facilities";

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

describe("OpenAPI document", () => {
	test("is served and well formed", async () => {
		const res = await app.inject({ method: "GET", url: "/docs/json" });
		assert.equal(res.statusCode, 200);

		const spec = res.json<{
			openapi: string;
			info: { title: string };
			paths: Record<string, unknown>;
		}>();
		assert.equal(spec.openapi, "3.1.0");
		assert.equal(spec.info.title, "Facility Search API");
		assert.deepEqual(Object.keys(spec.paths).sort(), [
			"/auth/login",
			"/auth/register",
			"/facilities",
			"/facilities/{id}",
			"/health",
		]);
	});

	test("documents search parameters generated from the route schema", async () => {
		const spec = (await app.inject({ method: "GET", url: "/docs/json" })).json<{
			paths: { "/facilities": { get: { parameters: { name: string }[] } } };
		}>();

		const names = spec.paths["/facilities"].get.parameters
			.map((p) => p.name)
			.sort();
		assert.deepEqual(names, [
			"addressContains",
			"amenityAnyOf",
			"limit",
			"nameContains",
			"offset",
		]);
	});

	test("documents the 404 on facility detail", async () => {
		const spec = (await app.inject({ method: "GET", url: "/docs/json" })).json<{
			paths: {
				"/facilities/{id}": { get: { responses: Record<string, unknown> } };
			};
		}>();

		assert.deepEqual(
			Object.keys(spec.paths["/facilities/{id}"].get.responses).sort(),
			["200", "400", "401", "404"],
		);
	});

	test("declares the bearer security scheme", async () => {
		const spec = (await app.inject({ method: "GET", url: "/docs/json" })).json<{
			components: { securitySchemes: Record<string, { scheme: string }> };
			paths: { "/facilities": { get: { security: unknown[] } } };
		}>();

		assert.equal(spec.components.securitySchemes.bearerAuth?.scheme, "bearer");
		assert.deepEqual(spec.paths["/facilities"].get.security, [
			{ bearerAuth: [] },
		]);
	});

	test("serves the UI", async () => {
		const res = await app.inject({ method: "GET", url: "/docs" });
		assert.ok(
			[200, 302].includes(res.statusCode),
			`unexpected status ${res.statusCode}`,
		);
	});
});
