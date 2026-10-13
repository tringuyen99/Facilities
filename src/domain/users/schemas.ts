import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const credentialsSchema = z
	.object({
		email: emailSchema.describe("Lower-cased and trimmed before storage"),
		// cant afford to have bad security around here
		password: z.string().min(12).max(200),
	})
	.meta({ id: "Credentials" });

export const userSchema = z
	.object({
		id: z.string(),
		email: emailSchema,
	})
	.meta({ id: "User" });

export const tokenSchema = z
	.object({
		token: z.string(),
		expiresIn: z.string().describe('Token lifetime, e.g. "1h"'),
	})
	.meta({ id: "Token" });

export type Credentials = z.infer<typeof credentialsSchema>;
export type PublicUser = z.infer<typeof userSchema>;
