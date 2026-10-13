import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { hash } from "@node-rs/argon2";
import { createPrismaClient } from "../../clients/db.ts";
import { loadConfig } from "../../config.ts";
import type { DomainLogger } from "../../lib/logger.ts";
import { authenticate } from "./operations.ts";

const prisma = createPrismaClient(loadConfig().databaseUrl);

const log: DomainLogger = { error: () => undefined, warn: () => undefined };

const PASSWORD = "a-sufficiently-long-password";

after(async () => {
	await prisma.user.deleteMany({
		where: { email: { startsWith: "ops-test-" } },
	});
	await prisma.$disconnect();
});

describe("authenticate", () => {
	test("an unparseable stored hash denies login rather than throwing", async () => {
		const email = "ops-test-corrupt@example.com";
		await prisma.user.deleteMany({ where: { email } });
		// argon2 raises "Decoding failed" on this; unguarded it became a 500,
		// which distinguished a corrupt account from a non-existent one.
		await prisma.user.create({
			data: { email, passwordHash: "$argon2id$placeholder" },
		});

		const result = await authenticate(
			prisma,
			{ email, password: PASSWORD },
			log,
		);

		assert.equal(result, null);
	});

	test("a valid hash authenticates", async () => {
		const email = "ops-test-valid@example.com";
		await prisma.user.deleteMany({ where: { email } });
		await prisma.user.create({
			data: { email, passwordHash: await hash(PASSWORD) },
		});

		const result = await authenticate(
			prisma,
			{ email, password: PASSWORD },
			log,
		);

		assert.equal(result?.email, email);
	});

	test("a wrong password is denied", async () => {
		const email = "ops-test-wrong@example.com";
		await prisma.user.deleteMany({ where: { email } });
		await prisma.user.create({
			data: { email, passwordHash: await hash(PASSWORD) },
		});

		const result = await authenticate(
			prisma,
			{ email, password: "wrong-but-long-enough" },
			log,
		);

		assert.equal(result, null);
	});
});
