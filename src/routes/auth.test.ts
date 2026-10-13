import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../app.ts";
import { loadConfig } from "../config.ts";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const DB_URL =
	process.env.DATABASE_URL ??
	"postgresql://facilities:facilities@localhost:5432/facilities";

let app: FastifyInstance;

const EMAIL = "auth-test@example.com";
const PASSWORD = "a-sufficiently-long-password";

// Annotated because app.inject is overloaded and otherwise infers the chainable form.
const register = (
	payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> => {
	return app.inject({ method: "POST", url: "/auth/register", payload });
};
const login = (
	payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> => {
	return app.inject({ method: "POST", url: "/auth/login", payload });
};

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
	await app.prisma.user.deleteMany({
		where: {
			OR: [
				{ email: { contains: "auth-test" } },
				{ email: "mixedcase@example.com" },
			],
		},
	});
	await register({ email: EMAIL, password: PASSWORD });
});

after(async () => {
	await app.prisma.user.deleteMany({
		where: {
			OR: [
				{ email: { contains: "auth-test" } },
				{ email: "mixedcase@example.com" },
			],
		},
	});
	await app.close();
});

describe("authentication defaults", () => {
	test("a route that declares nothing is protected", async () => {
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
		// No `config: { public: true }` — the point is that forgetting it denies.
		scratch.get("/accidentally-unconfigured", async () => ({ secret: "data" }));
		await scratch.ready();

		const res = await scratch.inject({
			method: "GET",
			url: "/accidentally-unconfigured",
		});
		await scratch.close();

		assert.equal(
			res.statusCode,
			401,
			"forgetting to mark a route public must not expose it",
		);
	});

	test("a route merely prefixed by /docs is not public", async () => {
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

		scratch.get("/docsets", async () => ({ secret: "data" }));
		await scratch.ready();

		const leaky = await scratch.inject({ method: "GET", url: "/docsets" });
		const realDocs = await scratch.inject({ method: "GET", url: "/docs/json" });
		await scratch.close();

		assert.equal(
			leaky.statusCode,
			401,
			"/docsets must not inherit the docs exemption",
		);
		assert.equal(realDocs.statusCode, 200, "the real docs must stay reachable");
	});

	test("an unmatched route is still a 404, not a 401", async () => {
		const res = await app.inject({ method: "GET", url: "/no-such-route" });
		assert.equal(res.statusCode, 404);
	});
});

describe("POST /auth/register", () => {
	test("creates an account and never echoes the password", async () => {
		const res = await register({
			email: "auth-test-new@example.com",
			password: PASSWORD,
		});

		assert.equal(res.statusCode, 201);
		const body = res.json<Record<string, unknown>>();
		assert.deepEqual(Object.keys(body).sort(), ["email", "id"]);
		assert.ok(!JSON.stringify(body).includes(PASSWORD));
	});

	test("stores an argon2id hash, not the password", async () => {
		const user = await app.prisma.user.findUnique({ where: { email: EMAIL } });
		assert.ok(user !== null);
		assert.ok(!user.passwordHash.includes(PASSWORD));
		assert.match(user.passwordHash, /^\$argon2id\$/);
	});

	test("salts, so two accounts with the same password hash differently", async () => {
		await register({
			email: "auth-test-salt-a@example.com",
			password: PASSWORD,
		});
		await register({
			email: "auth-test-salt-b@example.com",
			password: PASSWORD,
		});

		const [a, b] = await Promise.all([
			app.prisma.user.findUnique({
				where: { email: "auth-test-salt-a@example.com" },
			}),
			app.prisma.user.findUnique({
				where: { email: "auth-test-salt-b@example.com" },
			}),
		]);
		assert.notEqual(a?.passwordHash, b?.passwordHash);
	});

	test("rejects a duplicate email", async () => {
		const res = await register({ email: EMAIL, password: PASSWORD });
		assert.equal(res.statusCode, 409);
	});

	test("concurrent registrations of one email yield 201 and 409s, never a 500", async () => {
		const email = "auth-test-race@example.com";
		await app.prisma.user.deleteMany({ where: { email } });

		const results = await Promise.all(
			Array.from({ length: 5 }, () => register({ email, password: PASSWORD })),
		);
		const statuses = results.map((r) => r.statusCode).sort();

		// A read-then-insert let two requests both see no row, and the loser hit
		// the unique constraint as an unhandled 500 — a response the route's
		// declared {201, 400, 409} says cannot happen.
		assert.ok(!statuses.includes(500), `got ${statuses.join(",")}`);
		assert.equal(statuses.filter((s) => s === 201).length, 1);
		assert.equal(statuses.filter((s) => s === 409).length, 4);
		assert.equal(await app.prisma.user.count({ where: { email } }), 1);
	});

	test("the returned id is the row's real id", async () => {
		const email = "auth-test-id@example.com";
		await app.prisma.user.deleteMany({ where: { email } });

		const res = await register({ email, password: PASSWORD });
		const stored = await app.prisma.user.findUniqueOrThrow({
			where: { email },
		});

		// The id is generated in application code now, so it must match the row.
		assert.equal(res.json<{ id: string }>().id, stored.id);
	});

	test("rejects a short password", async () => {
		const res = await register({
			email: "auth-test-short@example.com",
			password: "short",
		});
		assert.equal(res.statusCode, 400);
	});

	test("normalises case and whitespace before storing", async () => {
		const res = await register({
			email: "  MixedCase@Example.COM  ",
			password: PASSWORD,
		});

		assert.equal(res.statusCode, 201);
		assert.equal(res.json<{ email: string }>().email, "mixedcase@example.com");
	});

	test("the same mailbox in different case is one account", async () => {
		await register({ email: "auth-test-dupe@example.com", password: PASSWORD });
		const again = await register({
			email: "AUTH-TEST-DUPE@EXAMPLE.COM",
			password: PASSWORD,
		});

		assert.equal(
			again.statusCode,
			409,
			"case must not create a second account",
		);
	});

	test("login accepts a different case than signup", async () => {
		await register({ email: "auth-test-case@example.com", password: PASSWORD });
		const res = await login({
			email: "Auth-Test-Case@Example.com",
			password: PASSWORD,
		});

		assert.equal(
			res.statusCode,
			200,
			"autocapitalisation must not lock a user out",
		);
	});

	test("rejects a malformed email", async () => {
		const res = await register({ email: "not-an-email", password: PASSWORD });
		assert.equal(res.statusCode, 400);
	});
});

describe("POST /auth/login", () => {
	test("returns a usable token", async () => {
		const res = await login({ email: EMAIL, password: PASSWORD });

		assert.equal(res.statusCode, 200);
		const body = res.json<{ token: string; expiresIn: string }>();
		assert.equal(body.expiresIn, "1h");

		const probe = await app.inject({
			method: "GET",
			url: "/facilities?limit=1",
			headers: { authorization: `Bearer ${body.token}` },
		});
		assert.equal(probe.statusCode, 200);
	});

	test("token carries the user id and email, and no password hash", async () => {
		const { token } = (await login({ email: EMAIL, password: PASSWORD })).json<{
			token: string;
		}>();
		const payload = JSON.parse(
			Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
		) as Record<string, unknown>;

		assert.equal(payload.email, EMAIL);
		assert.ok(typeof payload.sub === "string");
		assert.ok(typeof payload.exp === "number");
		// Previously this checked for "16384$" — an *scrypt* cost parameter, in a
		// codebase that stores argon2. It could never fail. Assert against the row.
		const stored = await app.prisma.user.findUnique({
			where: { email: EMAIL },
		});
		assert.ok(stored !== null);
		assert.ok(
			!JSON.stringify(payload).includes(stored.passwordHash),
			"the token must not carry the password hash",
		);
		assert.ok(!JSON.stringify(payload).includes("$argon2"));
	});

	test("rejects a wrong password", async () => {
		const res = await login({
			email: EMAIL,
			password: "wrong-but-long-enough-password",
		});
		assert.equal(res.statusCode, 401);
	});

	test("gives an identical response for unknown email and wrong password", async () => {
		const unknown = await login({
			email: "auth-test-nobody@example.com",
			password: PASSWORD,
		});
		const wrong = await login({
			email: EMAIL,
			password: "wrong-but-long-enough-password",
		});

		assert.equal(unknown.statusCode, wrong.statusCode);
		assert.deepEqual(
			unknown.json(),
			wrong.json(),
			"responses must not reveal which accounts exist",
		);
	});
});
