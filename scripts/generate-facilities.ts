/**
 * Generates seed data matching the shape of assets/facilities.json.
 *
 *   node scripts/generate-facilities.ts 100000 --out big.json --seed 7
 *
 * Deterministic for a given count and seed, so benchmark runs stay comparable.
 */

import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const MAX_FACILITIES = 100_000;

interface Facility {
	id: string;
	name: string;
	address: string;
	location: { latitude: number; longitude: number };
	facilities: string[];
}

/** Bounding box and postcode range are real, so state/coords/postcode stay consistent. */
interface City {
	name: string;
	state: string;
	suburbs: string[];
	postcodes: [number, number];
	lat: [number, number];
	lon: [number, number];
}

const CITIES: City[] = [
	{
		name: "Sydney",
		state: "NSW",
		suburbs: [
			"Sydney",
			"Parramatta",
			"Bondi",
			"Surry Hills",
			"Newtown",
			"Manly",
			"Chatswood",
			"Bankstown",
			"Cronulla",
			"Penrith",
		],
		postcodes: [2000, 2234],
		lat: [-34.05, -33.65],
		lon: [150.85, 151.3],
	},
	{
		name: "Melbourne",
		state: "VIC",
		suburbs: [
			"Melbourne",
			"Fitzroy",
			"St Kilda",
			"Richmond",
			"Carlton",
			"Brunswick",
			"Footscray",
			"Dandenong",
			"Box Hill",
			"Geelong",
		],
		postcodes: [3000, 3220],
		lat: [-38.05, -37.6],
		lon: [144.65, 145.35],
	},
	{
		name: "Brisbane",
		state: "QLD",
		suburbs: [
			"Brisbane",
			"Fortitude Valley",
			"South Bank",
			"Chermside",
			"Toowong",
			"Carindale",
			"Ipswich",
			"Redcliffe",
		],
		postcodes: [4000, 4179],
		lat: [-27.7, -27.3],
		lon: [152.9, 153.2],
	},
	{
		name: "Perth",
		state: "WA",
		suburbs: [
			"Perth",
			"Fremantle",
			"Joondalup",
			"Scarborough",
			"Subiaco",
			"Cannington",
			"Midland",
		],
		postcodes: [6000, 6112],
		lat: [-32.15, -31.75],
		lon: [115.7, 116.05],
	},
	{
		name: "Adelaide",
		state: "SA",
		suburbs: [
			"Adelaide",
			"Glenelg",
			"Norwood",
			"Prospect",
			"Marion",
			"Elizabeth",
			"Port Adelaide",
		],
		postcodes: [5000, 5118],
		lat: [-35.05, -34.75],
		lon: [138.5, 138.75],
	},
	{
		name: "Canberra",
		state: "ACT",
		suburbs: [
			"Canberra",
			"Belconnen",
			"Woden",
			"Gungahlin",
			"Tuggeranong",
			"Braddon",
		],
		postcodes: [2600, 2914],
		lat: [-35.45, -35.15],
		lon: [149.05, 149.2],
	},
	{
		name: "Hobart",
		state: "TAS",
		suburbs: ["Hobart", "Sandy Bay", "Glenorchy", "Kingston", "Battery Point"],
		postcodes: [7000, 7055],
		lat: [-42.95, -42.75],
		lon: [147.25, 147.4],
	},
	{
		name: "Darwin",
		state: "NT",
		suburbs: ["Darwin", "Palmerston", "Casuarina", "Nightcliff", "Parap"],
		postcodes: [800, 832],
		lat: [-12.5, -12.35],
		lon: [130.8, 130.95],
	},
];

const STREETS = [
	"Market",
	"High",
	"Beach",
	"Victoria",
	"George",
	"King",
	"Queen",
	"Church",
	"Station",
	"Park",
	"Collins",
	"Elizabeth",
	"Bourke",
	"Flinders",
	"Hay",
	"Rundle",
	"Adelaide",
	"Wickham",
	"Esplanade",
	"Mt Dandenong",
];
const STREET_TYPES = ["St", "Rd", "Ave", "Blvd", "Dr", "Pde", "Cres", "Way"];

const NAME_PREFIX = [
	"City",
	"Suburban",
	"Harbour View",
	"Zenith",
	"Apex",
	"Coastal",
	"Metro",
	"Summit",
	"Iron",
	"Pulse",
	"Elevate",
	"Southern",
	"Northern",
	"Peak",
	"Core",
	"Vital",
	"Anytime",
	"Prime",
];
const NAME_MIDDLE = [
	"Fitness",
	"Strength",
	"Wellness",
	"Health",
	"Training",
	"Athletic",
	"Boxing",
	"Aqua",
	"CrossFit",
	"Yoga",
	"Performance",
	"Movement",
];
const NAME_SUFFIX = [
	"Central",
	"Club",
	"Centre",
	"Studio",
	"Gym",
	"Hub",
	"Lab",
	"24/7",
	"Collective",
	"Co",
	"Express",
	"HQ",
];

const AMENITIES = [
	"24/7 Access",
	"Aqua Aerobics",
	"Athletics Track",
	"Basketball Court",
	"Beach Access",
	"Boxing Ring",
	"Cafe",
	"Cardio Equipment",
	"CrossFit Equipment",
	"Free Weights",
	"Group Classes",
	"Heavy Bags",
	"Kids Programs",
	"Lake Views",
	"Meditation Room",
	"Olympic Lifting Platform",
	"Olympic Pool",
	"Outdoor Training",
	"Parking",
	"Personal Training",
	"Pilates Studio",
	"Pool",
	"Powerlifting Equipment",
	"Sauna",
	"Spa",
	"Squash Courts",
	"Steam Room",
	"Strongman Equipment",
	"Tennis Courts",
	"Water Slides",
	"Yoga Classes",
];

/** mulberry32 — reproducible output without pulling in a dependency. */
function createRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function makeHelpers(random: () => number) {
	const pick = <T>(items: readonly T[]): T => {
		const item = items[Math.floor(random() * items.length)];
		if (item === undefined) {
			throw new Error("cannot pick from an empty list");
		}
		return item;
	};
	const intBetween = (min: number, max: number): number =>
		Math.floor(random() * (max - min + 1)) + min;
	const floatBetween = (min: number, max: number, dp: number): number =>
		Number((random() * (max - min) + min).toFixed(dp));
	return { pick, intBetween, floatBetween };
}

function buildFacility(
	index: number,
	padding: number,
	random: () => number,
): Facility {
	const { pick, intBetween, floatBetween } = makeHelpers(random);
	const city = pick(CITIES);

	// 3-6 unique amenities, matching the sample data's range.
	const amenities = new Set<string>();
	const target = intBetween(3, 6);
	while (amenities.size < target) {
		amenities.add(pick(AMENITIES));
	}

	const name = `${pick(NAME_PREFIX)} ${pick(NAME_MIDDLE)} ${pick(NAME_SUFFIX)}`;
	const postcode = String(
		intBetween(city.postcodes[0], city.postcodes[1]),
	).padStart(4, "0");
	const address = `${intBetween(1, 999)} ${pick(STREETS)} ${pick(STREET_TYPES)}, ${pick(city.suburbs)}, ${city.state} ${postcode}`;

	return {
		id: `facility-${String(index).padStart(padding, "0")}`,
		name,
		address,
		location: {
			latitude: floatBetween(city.lat[0], city.lat[1], 4),
			longitude: floatBetween(city.lon[0], city.lon[1], 4),
		},
		facilities: [...amenities],
	};
}

function parseArgs(argv: string[]): {
	count: number;
	out: string;
	seed: number;
} {
	const positional = argv.filter((arg) => !arg.startsWith("--"));
	const flag = (name: string): string | undefined => {
		const i = argv.indexOf(`--${name}`);
		return i === -1 ? undefined : argv[i + 1];
	};

	const count = Number(positional[0] ?? 1000);
	if (!Number.isInteger(count) || count < 1 || count > MAX_FACILITIES) {
		throw new Error(
			`count must be an integer between 1 and ${MAX_FACILITIES.toLocaleString()}, got "${positional[0]}"`,
		);
	}

	return {
		count,
		out: flag("out") ?? "data/facilities.json",
		seed: Number(flag("seed") ?? 42),
	};
}

async function main(): Promise<void> {
	const { count, out, seed } = parseArgs(process.argv.slice(2));
	const random = createRandom(seed);
	const padding = Math.max(3, String(count).length);

	await mkdir(dirname(out), { recursive: true });
	const stream = createWriteStream(out);

	// Incremental writes keep 100k records from forming one giant in-memory string.
	const write = async (chunk: string): Promise<void> => {
		if (!stream.write(chunk)) {
			await once(stream, "drain");
		}
	};

	await write("[\n");
	for (let i = 1; i <= count; i++) {
		const facility = buildFacility(i, padding, random);
		await write(`  ${JSON.stringify(facility)}${i < count ? "," : ""}\n`);
	}
	await write("]\n");

	stream.end();
	await once(stream, "finish");

	console.log(
		`Generated ${count.toLocaleString()} facilities → ${out} (seed ${seed})`,
	);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
