import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadConfig } from "./config.ts";

const JWT_SECRET = "test-secret-that-is-at-least-32-chars";
const DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://facilities:facilities@localhost:5432/facilities";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("loadConfig", () => {
	test("rejects an out-of-range port", () => {
		assert.throws(
			() => loadConfig({ PORT: "70000", JWT_SECRET }),
			/Invalid configuration.*PORT/,
		);
	});

	test("rejects an unknown NODE_ENV", () => {
		assert.throws(
			() => loadConfig({ NODE_ENV: "staging", JWT_SECRET }),
			/Invalid configuration.*NODE_ENV/,
		);
	});

	test("falls back to sensible defaults", () => {
		const config = loadConfig({ DATABASE_URL, REDIS_URL, JWT_SECRET });
		assert.equal(config.port, 3000);
		assert.equal(config.nodeEnv, "development");
	});

	test("silences logging under test", () => {
		assert.equal(
			loadConfig({ DATABASE_URL, REDIS_URL, NODE_ENV: "test", JWT_SECRET })
				.logLevel,
			"silent",
		);
	});

	test("requires a JWT secret", () => {
		assert.throws(() => loadConfig({}), /JWT_SECRET is required/);
	});

	test("rejects a JWT secret that is too short", () => {
		assert.throws(
			() => loadConfig({ JWT_SECRET: "too-short" }),
			/at least 32 characters/,
		);
	});

	test("REDIS_URL is required and must be a URL", () => {
		assert.throws(
			() => loadConfig({ DATABASE_URL, JWT_SECRET, REDIS_URL: "" }),
			/Invalid configuration.*REDIS_URL/,
		);
		assert.throws(
			() => loadConfig({ DATABASE_URL, JWT_SECRET }),
			/Invalid configuration.*REDIS_URL/,
		);
		assert.equal(
			loadConfig({ DATABASE_URL, JWT_SECRET, REDIS_URL }).redisUrl,
			REDIS_URL,
		);
	});
});
