import { hash, verify } from "@node-rs/argon2";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { DomainLogger } from "../../lib/logger.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import type { Credentials, PublicUser } from "./schemas.ts";

async function verifyPassword(
	storedHash: string,
	password: string,
	log: DomainLogger,
	email: string,
): Promise<boolean> {
	try {
		return await verify(storedHash, password);
	} catch (error) {
		log.error(
			{ err: error, email },
			"stored password hash could not be parsed; login denied",
		);
		return false;
	}
}

export type RegisterError = {
	readonly kind: "email-taken";
	readonly email: string;
};

export async function registerUser(
	prisma: PrismaClient,
	{ email, password }: Credentials,
): Promise<Result<PublicUser, RegisterError>> {
	// ON CONFLICT DO NOTHING: the database arbitrates in one statement, so a
	// conflict is an empty array rather than a race or an exception.
	const [user] = await prisma.user.createManyAndReturn({
		data: [{ email, passwordHash: await hash(password) }],
		skipDuplicates: true,
		select: { id: true, email: true },
	});

	if (user === undefined) {
		return err({ kind: "email-taken", email });
	}

	return ok(user);
}

export async function authenticate(
	prisma: PrismaClient,
	{ email, password }: Credentials,
	log: DomainLogger,
): Promise<PublicUser | null> {
	const user = await prisma.user.findUnique({
		where: { email },
		select: { id: true, email: true, passwordHash: true },
	});

	if (user === null) {
		return null;
	}

	if (!(await verifyPassword(user.passwordHash, password, log, email))) {
		return null;
	}

	return { id: user.id, email: user.email };
}
