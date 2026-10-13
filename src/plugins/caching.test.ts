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
let headers: { authorization: string };

const EMAIL = "caching-test@example.com";
const PASSWORD = "a-sufficiently-long-password";

before(async () => {
	app = await buildApp(
		loadConfig({
			DATABASE_URL: DB_URL,
			REDIS_URL: REDIS_URL,
			RATE_LIMIT_NAMESPACE: randomUUID(),
			NODE_ENV: "test",
			JWT_SECRET: "test-secret-that-is-at-least-32-chars",
			RATE_LIMIT_MAX: "10000",
			RATE_LIMIT_LOGIN_MAX: "10000",
			RATE_LIMIT_REGISTER_MAX: "10000",
		}),
	);
	await app.ready();

	await app.prisma.user.deleteMany({ where: { email: EMAIL } });
	await app.inject({
		method: "POST",
		url: "/auth/register",
		payload: { email: EMAIL, password: PASSWORD },
	});
	const login = await app.inject({
		method: "POST",
		url: "/auth/login",
		payload: { email: EMAIL, password: PASSWORD },
	});
	headers = {
		authorization: `Bearer ${login.json<{ token: string }>().token}`,
	};

	await app.prisma.facility.deleteMany({ where: { id: "cache-test-1" } });
	await app.prisma.facility.create({
		data: {
			id: "cache-test-1",
			name: "Cachetest Fitness",
			address: "1 Cache St, Sydney, NSW 2000",
			latitude: -33.87,
			longitude: 151.21,
		},
	});
});

after(async () => {
	await app.prisma.facility.deleteMany({ where: { id: "cache-test-1" } });
	await app.prisma.user.deleteMany({ where: { email: EMAIL } });
	await app.close();
});

describe("HTTP caching", () => {
	test("detail is cacheable by the client only, never a shared cache", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities/cache-test-1",
			headers,
		});

		assert.equal(res.statusCode, 200);
		assert.equal(res.headers["cache-control"], "private, max-age=300");
		assert.ok(
			!String(res.headers["cache-control"]).includes("public"),
			"public would let a CDN serve authenticated data to anyone with the URL",
		);
	});

	test("search gets a shorter window", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities?limit=1",
			headers,
		});
		assert.equal(res.headers["cache-control"], "private, max-age=60");
	});

	test("auth responses are never stored", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/auth/login",
			payload: { email: EMAIL, password: PASSWORD },
		});
		assert.equal(
			res.headers["cache-control"],
			"no-store",
			"a cached token response would leak credentials",
		);
	});

	test("health is never cached", async () => {
		const res = await app.inject({ method: "GET", url: "/health" });
		assert.equal(res.headers["cache-control"], "no-store");
	});

	test("cacheable responses vary on Authorization", async () => {
		const detail = await app.inject({
			method: "GET",
			url: "/facilities/cache-test-1",
			headers,
		});
		const search = await app.inject({
			method: "GET",
			url: "/facilities?limit=1",
			headers,
		});

		assert.equal(
			detail.headers.vary,
			"Authorization",
			"without Vary a browser reuses one session's body for the next",
		);
		assert.equal(search.headers.vary, "Authorization");
	});

	test("responses carry an ETag", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities/cache-test-1",
			headers,
		});
		assert.ok(res.headers.etag !== undefined, "no ETag means no revalidation");
	});

	test("a matching If-None-Match gets 304 with no body", async () => {
		const first = await app.inject({
			method: "GET",
			url: "/facilities/cache-test-1",
			headers,
		});
		const second = await app.inject({
			method: "GET",
			url: "/facilities/cache-test-1",
			headers: { ...headers, "if-none-match": String(first.headers.etag) },
		});

		assert.equal(second.statusCode, 304);
		assert.equal(second.body, "");
	});

	test("a stale If-None-Match gets a fresh 200", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities/cache-test-1",
			headers: { ...headers, "if-none-match": '"not-the-current-etag"' },
		});

		assert.equal(res.statusCode, 200);
		assert.ok(res.body.length > 0);
	});

	test("errors are never cached", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities/does-not-exist",
			headers,
		});
		assert.equal(res.statusCode, 404);
		assert.equal(res.headers["cache-control"], "no-store");
	});
});
