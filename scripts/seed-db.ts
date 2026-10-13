/**
 * Loads generated facility JSON into Postgres.
 *
 *   node scripts/seed-db.ts --file other.json --reset --fast
 *
 * Two paths on purpose: `createMany` reads clearly for the default ~1k seed;
 * `--fast` expands the document server-side, which is the difference between
 * seconds and minutes once the join table reaches ~450k rows.
 */

import { readFile } from "node:fs/promises";
import { createPrismaClient } from "../src/clients/db.ts";
import { loadConfig } from "../src/config.ts";

const prisma = createPrismaClient(loadConfig().databaseUrl);

interface SeedFacility {
	id: string;
	name: string;
	address: string;
	location: { latitude: number; longitude: number };
	facilities: string[];
}

function parseArgs(argv: string[]): {
	file: string;
	fast: boolean;
	reset: boolean;
} {
	const flagValue = (name: string): string | undefined => {
		const i = argv.indexOf(`--${name}`);
		return i === -1 ? undefined : argv[i + 1];
	};
	return {
		file: flagValue("file") ?? "data/facilities.json",
		fast: argv.includes("--fast"),
		reset: argv.includes("--reset"),
	};
}

async function upsertAmenities(
	facilities: SeedFacility[],
): Promise<Map<string, number>> {
	const names = [...new Set(facilities.flatMap((f) => f.facilities))].sort();

	await prisma.amenity.createMany({
		data: names.map((name) => ({ name })),
		skipDuplicates: true,
	});

	const rows = await prisma.amenity.findMany({
		select: { id: true, name: true },
	});
	return new Map(rows.map((row) => [row.name, row.id]));
}

async function seedWithCreateMany(
	facilities: SeedFacility[],
	amenityIds: Map<string, number>,
): Promise<void> {
	await prisma.facility.createMany({
		data: facilities.map((f) => ({
			id: f.id,
			name: f.name,
			address: f.address,
			latitude: f.location.latitude,
			longitude: f.location.longitude,
		})),
		skipDuplicates: true,
	});

	const links = facilities.flatMap((f) =>
		f.facilities.map((name) => {
			const amenityId = amenityIds.get(name);
			if (amenityId === undefined) {
				throw new Error(`unknown amenity "${name}"`);
			}
			return { facilityId: f.id, amenityId };
		}),
	);

	// Chunked so no single statement carries hundreds of thousands of rows.
	const CHUNK = 10_000;
	for (let i = 0; i < links.length; i += CHUNK) {
		await prisma.facilityAmenity.createMany({
			data: links.slice(i, i + CHUNK),
			skipDuplicates: true,
		});
	}
}

async function seedWithRawSql(json: string): Promise<void> {
	await prisma.$executeRaw`
    INSERT INTO "Facility" (id, name, address, latitude, longitude)
    SELECT id, name, address,
           (location->>'latitude')::double precision,
           (location->>'longitude')::double precision
    FROM jsonb_to_recordset(${json}::jsonb)
      AS x(id text, name text, address text, location jsonb, facilities jsonb)
    ON CONFLICT (id) DO NOTHING`;

	await prisma.$executeRaw`
    INSERT INTO "Amenity" (name)
    SELECT DISTINCT jsonb_array_elements_text(facilities)
    FROM jsonb_to_recordset(${json}::jsonb) AS x(facilities jsonb)
    ON CONFLICT (name) DO NOTHING`;

	await prisma.$executeRaw`
    INSERT INTO "FacilityAmenity" ("facilityId", "amenityId")
    SELECT x.id, a.id
    FROM jsonb_to_recordset(${json}::jsonb) AS x(id text, facilities jsonb)
    CROSS JOIN LATERAL jsonb_array_elements_text(x.facilities) AS amenity_name
    JOIN "Amenity" a ON a.name = amenity_name
    ON CONFLICT DO NOTHING`;
}

async function main(): Promise<void> {
	const { file, fast, reset } = parseArgs(process.argv.slice(2));
	const started = Date.now();

	const json = await readFile(file, "utf8");
	const facilities = JSON.parse(json) as SeedFacility[];
	console.log(
		`Read ${facilities.length.toLocaleString()} facilities from ${file}`,
	);

	if (reset) {
		// CASCADE clears the join table; RESTART IDENTITY resets amenity ids.
		await prisma.$executeRawUnsafe(
			'TRUNCATE "Facility", "Amenity" RESTART IDENTITY CASCADE',
		);
		console.log("Truncated existing rows");
	}

	if (fast) {
		await seedWithRawSql(json);
	} else {
		await seedWithCreateMany(facilities, await upsertAmenities(facilities));
	}

	const [facilityCount, amenityCount, linkCount] = await Promise.all([
		prisma.facility.count(),
		prisma.amenity.count(),
		prisma.facilityAmenity.count(),
	]);

	console.log(
		`Seeded in ${((Date.now() - started) / 1000).toFixed(2)}s — ` +
			`${facilityCount.toLocaleString()} facilities, ${amenityCount} amenities, ${linkCount.toLocaleString()} links`,
	);
}

main()
	.catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	})
	.finally(() => void prisma.$disconnect());
