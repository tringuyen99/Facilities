import { defineConfig } from "prisma/config";

try {
	process.loadEnvFile(".env");
} catch {}

export default defineConfig({
	schema: "prisma/schema.prisma",
	migrations: {
		path: "prisma/migrations",
	},
	// Required to declare `extensions = [pg_trgm]` in the schema.
	experimental: {
		extensions: true,
	},
	// Set only when present, rather than env("DATABASE_URL") which throws on a
	// missing value. `prisma generate` needs no database, and it has to work on a
	// fresh clone that has no .env yet — otherwise nothing can be built at all.
	// Commands that do need a connection still fail with Prisma's own message.
	...(process.env.DATABASE_URL !== undefined && {
		datasource: { url: process.env.DATABASE_URL },
	}),
});
