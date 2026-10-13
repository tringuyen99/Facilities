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
			// Deliberately tiny so the limit is reachable in a test.
			RATE_LIMIT_MAX: "3",
			RATE_LIMIT_LOGIN_MAX: "2",
			RATE_LIMIT_REGISTER_MAX: "2",
			// No REDIS_URL: the in-memory store keeps this suite isolated.
		}),
	);
	await app.ready();
});

after(async () => {
	await app.close();
});

type Injected = {
	statusCode: number;
	headers: Record<string, unknown>;
	body: string;
};

const loginOn = (instance: FastifyInstance): Promise<Injected> =>
	instance.inject({
		method: "POST",
		url: "/auth/login",
		payload: {
			email: "rl-test@example.com",
			password: "a-sufficiently-long-password",
		},
	});

/**
 * Counting tests get their own instance and so their own in-memory counters.
 * Sharing one would make each test depend on how many requests the tests before
 * it happened to make — which is why the 429 assertion below used to fail when
 * run on its own.
 */
async function appWithLoginLimit(max: number): Promise<FastifyInstance> {
	const instance = await buildApp(
		loadConfig({
			DATABASE_URL: DB_URL,
			REDIS_URL: REDIS_URL,
			RATE_LIMIT_NAMESPACE: randomUUID(),
			NODE_ENV: "test",
			JWT_SECRET: "test-secret-that-is-at-least-32-chars",
			RATE_LIMIT_MAX: "100",
			RATE_LIMIT_LOGIN_MAX: String(max),
			RATE_LIMIT_REGISTER_MAX: "100",
		}),
	);
	await instance.ready();
	return instance;
}

describe("rate limiting", () => {
	test("rejects once the login limit is exceeded", async () => {
		const instance = await appWithLoginLimit(2);
		const statuses: number[] = [];
		for (let i = 0; i < 4; i++) {
			statuses.push((await loginOn(instance)).statusCode);
		}
		await instance.close();

		assert.deepEqual(
			statuses.map((s) => s === 429),
			[false, false, true, true],
			"the first two attempts should be allowed, the rest throttled",
		);
	});

	test("a 429 carries the standard error shape and retry headers", async () => {
		const instance = await appWithLoginLimit(1);

		const allowed = await loginOn(instance);
		const res = await loginOn(instance);
		await instance.close();

		assert.notEqual(allowed.statusCode, 429, "the first call must be allowed");
		assert.equal(res.statusCode, 429);
		assert.partialDeepStrictEqual(JSON.parse(res.body), {
			error: "Too Many Requests",
			statusCode: 429,
		});
		assert.equal(res.headers["x-ratelimit-limit"], "1");
		assert.ok(res.headers["retry-after"] !== undefined);
	});

	test("/docs is never throttled", async () => {
		const statuses: number[] = [];
		for (let i = 0; i < 10; i++) {
			statuses.push(
				(await app.inject({ method: "GET", url: "/docs/json" })).statusCode,
			);
		}
		assert.deepEqual(
			[...new Set(statuses)],
			[200],
			"doc assets must not drain a viewer budget",
		);
	});

	test("/health is never throttled", async () => {
		const statuses: number[] = [];
		for (let i = 0; i < 10; i++) {
			statuses.push(
				(await app.inject({ method: "GET", url: "/health" })).statusCode,
			);
		}
		assert.deepEqual(
			[...new Set(statuses)],
			[200],
			"probes must not be rate limited",
		);
	});

	test("authenticated requests are keyed by user, not shared across users", async () => {
		const tokenFor = async (email: string): Promise<string> => {
			await app.prisma.user.deleteMany({ where: { email } });
			// Mint directly: /auth/register has its own tight limit in this suite.
			const user = await app.prisma.user.create({
				data: { email, passwordHash: "$argon2id$placeholder" },
				select: { id: true, email: true },
			});
			return app.jwt.sign({ sub: user.id, email: user.email });
		};

		const [alice, bob] = await Promise.all([
			tokenFor("rl-alice@example.com"),
			tokenFor("rl-bob@example.com"),
		]);

		// Exhaust Alice's global budget of 3.
		for (let i = 0; i < 4; i++) {
			await app.inject({
				method: "GET",
				url: "/facilities?limit=1",
				headers: { authorization: `Bearer ${alice}` },
			});
		}
		const aliceBlocked = await app.inject({
			method: "GET",
			url: "/facilities?limit=1",
			headers: { authorization: `Bearer ${alice}` },
		});
		const bobFine = await app.inject({
			method: "GET",
			url: "/facilities?limit=1",
			headers: { authorization: `Bearer ${bob}` },
		});

		assert.equal(aliceBlocked.statusCode, 429);
		assert.equal(
			bobFine.statusCode,
			200,
			"Bob's budget must be independent of Alice's",
		);

		await app.prisma.user.deleteMany({
			where: { email: { startsWith: "rl-" } },
		});
	});
});
