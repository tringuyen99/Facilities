import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createPrismaClient } from "../../clients/db.ts";
import { loadConfig } from "../../config.ts";
import { escapeLike, getFacilityById, searchFacilities } from "./operations.ts";

const prisma = createPrismaClient(loadConfig().databaseUrl);

/**
 * Fixtures carry the marker "Zedcorp" so assertions can be scoped to them
 * even when the database also holds generated seed data. Generated names
 * never contain `%` or `_`, which is what makes the escaping tests exact.
 */
const FIXTURES = [
	{
		id: "test-city",
		name: "City Fitness Zedcorp",
		address: "1 Zedcorp St, Bondi, NSW 2026",
		amenities: ["Pool", "Sauna"],
	},
	{
		id: "test-mid",
		name: "Electricity Gym Zedcorp",
		address: "2 Zedcorp St, Parramatta, NSW 2150",
		amenities: ["Pool"],
	},
	{
		id: "test-pct",
		name: "100% Fitness Zedcorp",
		address: "3 Zedcorp St, Bondi, NSW 2026",
		amenities: ["Sauna"],
	},
	{
		id: "test-underscore",
		name: "Zenith_Health Zedcorp",
		address: "4 Zedcorp St, Hobart, TAS 7000",
		amenities: [],
	},
];

before(async () => {
	for (const f of FIXTURES) {
		await prisma.facility.create({
			data: {
				id: f.id,
				name: f.name,
				address: f.address,
				latitude: -33.87,
				longitude: 151.21,
				amenities: {
					create: f.amenities.map((name) => ({
						amenity: {
							connectOrCreate: { where: { name }, create: { name } },
						},
					})),
				},
			},
		});
	}
});

after(async () => {
	await prisma.facility.deleteMany({ where: { id: { startsWith: "test-" } } });
	await prisma.$disconnect();
});

describe("escapeLike", () => {
	test("escapes LIKE metacharacters", () => {
		assert.equal(escapeLike("100%"), "100\\%");
		assert.equal(escapeLike("a_b"), "a\\_b");
		assert.equal(escapeLike("back\\slash"), "back\\\\slash");
	});

	test("leaves ordinary text untouched", () => {
		assert.equal(escapeLike("City Fitness"), "City Fitness");
	});
});

describe("searchFacilities", () => {
	test("matches a partial name, case-insensitively", async () => {
		const result = await searchFacilities(prisma, {
			nameContains: "city fitness zedcorp",
			limit: 20,
			offset: 0,
		});
		assert.deepEqual(
			result.data.map((f) => f.id),
			["test-city"],
		);
	});

	test("a bare % does not match everything", async () => {
		const result = await searchFacilities(prisma, {
			nameContains: "%",
			limit: 20,
			offset: 0,
		});
		assert.deepEqual(
			result.data.map((f) => f.id),
			["test-pct"],
		);
		assert.equal(result.pagination.hasMore, false);
	});

	test("a bare _ does not act as a single-character wildcard", async () => {
		const result = await searchFacilities(prisma, {
			nameContains: "Zenith_Health",
			limit: 20,
			offset: 0,
		});
		assert.deepEqual(
			result.data.map((f) => f.id),
			["test-underscore"],
		);
	});

	test("amenity filter is OR, not AND", async () => {
		const either = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			amenityAnyOf: ["Pool", "Sauna"],
			limit: 20,
			offset: 0,
		});
		assert.deepEqual(
			either.data.map((f) => f.id).sort(),
			["test-city", "test-mid", "test-pct"],
			"every facility with EITHER amenity should match, not only the one with both",
		);
	});

	test("adding a value widens the result, never narrows it", async () => {
		const one = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			amenityAnyOf: ["Pool"],
			limit: 20,
			offset: 0,
		});
		const two = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			amenityAnyOf: ["Pool", "Sauna"],
			limit: 20,
			offset: 0,
		});

		const widened = new Set(two.data.map((f) => f.id));
		for (const facility of one.data) {
			assert.ok(
				widened.has(facility.id),
				`${facility.id} matched one value but not the superset — that is AND behaviour`,
			);
		}
		assert.ok(two.data.length > one.data.length);
	});

	test("repeated amenity counts once", async () => {
		const result = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			amenityAnyOf: ["Pool", "Pool"],
			limit: 20,
			offset: 0,
		});
		assert.deepEqual(result.data.map((f) => f.id).sort(), [
			"test-city",
			"test-mid",
		]);
	});

	test("an empty amenity value is ignored, not treated as a filter", async () => {
		const withEmpty = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			amenityAnyOf: [""],
			limit: 20,
			offset: 0,
		});
		const without = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			limit: 20,
			offset: 0,
		});

		assert.deepEqual(
			withEmpty.data.map((f) => f.id).sort(),
			without.data.map((f) => f.id).sort(),
			"?amenity= must behave as if the key were absent, like the text filters",
		);
	});

	test("an empty value alongside a real one does not void the search", async () => {
		const result = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			amenityAnyOf: ["Pool", ""],
			limit: 20,
			offset: 0,
		});

		assert.deepEqual(result.data.map((f) => f.id).sort(), [
			"test-city",
			"test-mid",
		]);
	});

	test("unknown amenity yields an empty result, not an error", async () => {
		const result = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			amenityAnyOf: ["Jacuzzi"],
			limit: 20,
			offset: 0,
		});
		assert.deepEqual(result.data, []);
		assert.equal(result.pagination.hasMore, false);
	});

	test("results are ordered by name", async () => {
		const result = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			limit: 20,
			offset: 0,
		});
		const names = result.data.map((f) => f.name);
		assert.deepEqual(names, [...names].sort());
	});

	test("hasMore flags a further page without over-returning", async () => {
		const page1 = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			limit: 2,
			offset: 0,
		});
		const page2 = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			limit: 2,
			offset: 2,
		});

		assert.equal(
			page1.data.length,
			2,
			"the extra probe row must not leak into data",
		);
		assert.equal(page1.pagination.hasMore, true);

		assert.equal(page2.data.length, 2);
		assert.equal(
			page2.pagination.hasMore,
			false,
			"four fixtures means page 2 is the last",
		);

		const ids = [...page1.data, ...page2.data].map((f) => f.id);
		assert.equal(new Set(ids).size, 4, "pages must not overlap");
	});

	test("search results carry coordinates but not amenities", async () => {
		const result = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			limit: 1,
			offset: 0,
		});
		assert.deepEqual(Object.keys(result.data[0] ?? {}).sort(), [
			"address",
			"id",
			"latitude",
			"longitude",
			"name",
		]);
		assert.equal(result.data[0]?.latitude, -33.87);
	});
});

describe("pagination stability", () => {
	const SHARED_NAME = "Tiebreak Identical Zedcorp";

	before(async () => {
		await prisma.facility.createMany({
			data: Array.from({ length: 10 }, (_, i) => ({
				id: `test-tie-${i}`,
				name: SHARED_NAME,
				address: `${i} Tiebreak St, Sydney, NSW 2000`,
				latitude: -33.87,
				longitude: 151.21,
			})),
		});
	});

	after(async () => {
		await prisma.facility.deleteMany({
			where: { id: { startsWith: "test-tie-" } },
		});
	});

	test("consecutive pages of identically named rows never overlap", async () => {
		// Every row shares one name, so ordering by name alone leaves Postgres free
		// to return them differently per query and the pages drift.
		const pages = await Promise.all(
			[0, 4, 8].map((offset) =>
				searchFacilities(prisma, {
					nameContains: SHARED_NAME,
					limit: 4,
					offset,
				}),
			),
		);

		const ids = pages.flatMap((page) => page.data.map((f) => f.id));
		assert.equal(ids.length, 10, "three pages of 4 over 10 rows");
		assert.equal(
			new Set(ids).size,
			ids.length,
			"a row must not appear on two pages",
		);
	});

	test("the same page is identical when queried twice", async () => {
		const [a, b] = await Promise.all([
			searchFacilities(prisma, {
				nameContains: SHARED_NAME,
				limit: 4,
				offset: 4,
			}),
			searchFacilities(prisma, {
				nameContains: SHARED_NAME,
				limit: 4,
				offset: 4,
			}),
		]);

		assert.deepEqual(
			a.data.map((f) => f.id),
			b.data.map((f) => f.id),
		);
	});
});

describe("searchFacilities — address", () => {
	test("matches a partial address", async () => {
		// "Zedcorp St, Bondi" is unique to the fixtures; a bare "Bondi" would also
		// match generated seed rows, since Bondi is a real suburb in the generator.
		const result = await searchFacilities(prisma, {
			addressContains: "Zedcorp St, Bondi",
			limit: 20,
			offset: 0,
		});
		assert.deepEqual(result.data.map((f) => f.id).sort(), [
			"test-city",
			"test-pct",
		]);
	});

	test("escapes wildcards in address too", async () => {
		const result = await searchFacilities(prisma, {
			addressContains: "%",
			limit: 20,
			offset: 0,
		});
		assert.deepEqual(result.data, []);
	});

	test("name and address compose with AND", async () => {
		const result = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			addressContains: "Parramatta",
			limit: 20,
			offset: 0,
		});
		assert.deepEqual(
			result.data.map((f) => f.id),
			["test-mid"],
		);
	});

	test("name, address and amenity all compose", async () => {
		const match = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			addressContains: "Bondi",
			amenityAnyOf: ["Sauna"],
			limit: 20,
			offset: 0,
		});
		assert.deepEqual(match.data.map((f) => f.id).sort(), [
			"test-city",
			"test-pct",
		]);

		const none = await searchFacilities(prisma, {
			nameContains: "Zedcorp",
			addressContains: "Hobart",
			amenityAnyOf: ["Pool"],
			limit: 20,
			offset: 0,
		});
		assert.deepEqual(none.data, []);
	});
});

describe("getFacilityById", () => {
	test("returns full detail with a flat amenity list", async () => {
		const facility = await getFacilityById(prisma, "test-city");

		assert.equal(facility?.name, "City Fitness Zedcorp");
		assert.equal(facility?.latitude, -33.87);
		assert.equal(facility?.longitude, 151.21);
		assert.deepEqual(facility?.amenities.sort(), ["Pool", "Sauna"]);
	});

	test("returns null for an unknown id", async () => {
		assert.equal(
			await getFacilityById(prisma, "facility-does-not-exist"),
			null,
		);
	});
});
