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

const TEST_EMAIL = "facilities-route-test@example.com";
const TEST_PASSWORD = "a-sufficiently-long-password";

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

	await app.prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
	await app.inject({
		method: "POST",
		url: "/auth/register",
		payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
	});
	const login = await app.inject({
		method: "POST",
		url: "/auth/login",
		payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
	});
	headers = {
		authorization: `Bearer ${login.json<{ token: string }>().token}`,
	};

	await app.prisma.facility.create({
		data: {
			id: "route-test-1",
			name: "Routetest Aquatic Centre",
			address: "7 Route St, Sydney, NSW 2000",
			latitude: -33.87,
			longitude: 151.21,
			amenities: {
				create: ["Pool", "Sauna"].map((name) => ({
					amenity: { connectOrCreate: { where: { name }, create: { name } } },
				})),
			},
		},
	});
});

after(async () => {
	await app.prisma.facility.deleteMany({
		where: { id: { startsWith: "route-test-" } },
	});
	await app.prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
	await app.close();
});

describe("GET /facilities", () => {
	test("returns matches in the data/pagination envelope", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities?nameContains=Routetest",
			headers,
		});

		assert.equal(res.statusCode, 200);
		const body = res.json<{
			data: { id: string }[];
			pagination: { limit: number; offset: number; hasMore: boolean };
		}>();
		assert.deepEqual(
			body.data.map((f) => f.id),
			["route-test-1"],
		);
		assert.deepEqual(body.pagination, { limit: 20, offset: 0, hasMore: false });
	});

	test("accepts a short search term", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities?nameContains=a&limit=1",
			headers,
		});
		assert.equal(res.statusCode, 200);
	});

	test("filters by address", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities?addressContains=Route%20St",
			headers,
		});
		assert.deepEqual(
			res.json<{ data: { id: string }[] }>().data.map((f) => f.id),
			["route-test-1"],
		);
	});

	test("name and address compose", async () => {
		const hit = await app.inject({
			method: "GET",
			url: "/facilities?nameContains=Routetest&addressContains=Route%20St",
			headers,
		});
		const miss = await app.inject({
			method: "GET",
			url: "/facilities?nameContains=Routetest&addressContains=Melbourne",
			headers,
		});

		assert.equal(hit.json<{ data: unknown[] }>().data.length, 1);
		assert.equal(miss.json<{ data: unknown[] }>().data.length, 0);
	});

	test("rejects an unknown query parameter", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities?nope=1",
			headers,
		});
		assert.equal(res.statusCode, 400);
	});

	test("rejects limit above the cap", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities?limit=500",
			headers,
		});
		assert.equal(res.statusCode, 400);
	});

	test("rejects more amenity values than the cap", async () => {
		const many = Array.from(
			{ length: 21 },
			(_, i) => `amenityAnyOf=A${i}`,
		).join("&");
		const res = await app.inject({
			method: "GET",
			url: `/facilities?${many}`,
			headers,
		});

		assert.equal(
			res.statusCode,
			400,
			"the querystring stays bounded; only 31 amenities exist",
		);
	});

	test("accepts a filter at the cap", async () => {
		const many = Array.from(
			{ length: 20 },
			(_, i) => `amenityAnyOf=A${i}`,
		).join("&");
		const res = await app.inject({
			method: "GET",
			url: `/facilities?${many}`,
			headers,
		});

		assert.equal(res.statusCode, 200);
	});

	test("rejects a negative offset", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities?offset=-1",
			headers,
		});
		assert.equal(res.statusCode, 400);
	});

	test("a wildcard query does not return the whole table", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities?nameContains=%25%25",
			headers,
		});

		assert.equal(res.statusCode, 200);
		assert.deepEqual(res.json<{ data: unknown[] }>().data, []);
	});

	test("a single amenity arrives as an array", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities?nameContains=Routetest&amenityAnyOf=Pool",
			headers,
		});

		assert.equal(res.statusCode, 200);
		assert.deepEqual(
			res.json<{ data: { id: string }[] }>().data.map((f) => f.id),
			["route-test-1"],
		);
	});

	test("repeated amenity params are ORed", async () => {
		// The fixture has Pool and Sauna but no Tennis Courts. Under OR the
		// unmatched value is harmless; under AND it would have excluded the row.
		const oneOfTwo = await app.inject({
			method: "GET",
			url: "/facilities?nameContains=Routetest&amenityAnyOf=Pool&amenityAnyOf=Tennis%20Courts",
			headers,
		});
		const neither = await app.inject({
			method: "GET",
			url: "/facilities?nameContains=Routetest&amenityAnyOf=Tennis%20Courts&amenityAnyOf=Squash%20Courts",
			headers,
		});

		assert.deepEqual(
			oneOfTwo.json<{ data: { id: string }[] }>().data.map((f) => f.id),
			["route-test-1"],
			"matching one of the two values is enough",
		);
		assert.equal(neither.json<{ data: unknown[] }>().data.length, 0);
	});

	test("omitting all filters browses the collection", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities?limit=5",
			headers,
		});

		assert.equal(res.statusCode, 200);
		const body = res.json<{
			data: unknown[];
			pagination: { hasMore: boolean };
		}>();
		assert.equal(body.data.length, 5);
		assert.equal(body.pagination.hasMore, true);
	});
});

describe("authentication", () => {
	test("search rejects a request with no token", async () => {
		const res = await app.inject({ method: "GET", url: "/facilities" });
		assert.equal(res.statusCode, 401);
		assert.partialDeepStrictEqual(res.json(), {
			error: "Unauthorized",
			statusCode: 401,
		});
	});

	test("detail rejects a request with no token", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities/route-test-1",
		});
		assert.equal(res.statusCode, 401);
	});

	test("rejects a malformed token", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities",
			headers: { authorization: "Bearer not-a-jwt" },
		});
		assert.equal(res.statusCode, 401);
	});

	test("rejects a token signed with the wrong secret", async () => {
		const other = await buildApp(
			loadConfig({
				DATABASE_URL: DB_URL,
				REDIS_URL: REDIS_URL,
				RATE_LIMIT_NAMESPACE: randomUUID(),
				NODE_ENV: "test",
				JWT_SECRET: "a-completely-different-secret-key-32",
			}),
		);
		await other.ready();
		const forged = other.jwt.sign({ sub: "someone", email: "x@example.com" });
		await other.close();

		const res = await app.inject({
			method: "GET",
			url: "/facilities",
			headers: { authorization: `Bearer ${forged}` },
		});
		assert.equal(res.statusCode, 401);
	});
});

describe("GET /facilities/:id", () => {
	test("returns full detail matching the source data shape", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities/route-test-1",
			headers,
		});

		assert.equal(res.statusCode, 200);
		const body = res.json<Record<string, unknown>>();
		assert.deepEqual(Object.keys(body).sort(), [
			"address",
			"amenities",
			"id",
			"latitude",
			"longitude",
			"name",
		]);
		assert.equal(body.latitude, -33.87);
		assert.deepEqual((body.amenities as string[]).sort(), ["Pool", "Sauna"]);
	});

	test("returns a structured 404 for an unknown id", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/facilities/nope",
			headers,
		});

		assert.equal(res.statusCode, 404);
		assert.partialDeepStrictEqual(res.json(), {
			error: "Not Found",
			statusCode: 404,
		});
	});
});
