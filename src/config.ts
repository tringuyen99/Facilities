import { z } from "zod";

/** One policy per scope, so a limit is a single object rather than a max here and a window there. */
export interface RateLimitPolicy {
	readonly max: number;
	readonly timeWindow: string;
}

export interface Config {
	readonly databaseUrl: string;
	readonly host: string;
	readonly port: number;
	readonly logLevel: string;
	readonly nodeEnv: "development" | "test" | "production";
	readonly jwtSecret: string;
	readonly jwtTtl: string;
	readonly redisUrl: string;
	readonly rateLimit: {
		/** Key prefix, so separate deployments — and separate test suites — don't share counters. */
		readonly nameSpace: string;
		readonly global: RateLimitPolicy;
		readonly login: RateLimitPolicy;
		readonly register: RateLimitPolicy;
	};
}

const count = z.coerce.number().int().positive();

const envSchema = z.object({
	DATABASE_URL: z.url({
		error: "DATABASE_URL is required — copy .env.example to .env",
	}),
	HOST: z.string().default("0.0.0.0"),
	PORT: z.coerce.number().int().min(1).max(65535).default(3000),
	NODE_ENV: z
		.enum(["development", "test", "production"])
		.default("development"),
	LOG_LEVEL: z.string().optional(),
	// A short secret can be brute-forced offline from one captured token.
	JWT_SECRET: z
		.string({
			error:
				"JWT_SECRET is required — generate one with `openssl rand -base64 32`",
		})
		.min(32, "JWT_SECRET must be at least 32 characters"),
	JWT_TTL: z.string().default("1h"),
	REDIS_URL: z.url({
		error: "REDIS_URL is required — run `pnpm db:up` to start it",
	}),
	RATE_LIMIT_NAMESPACE: z.string().min(1).default("facilities"),
	RATE_LIMIT_MAX: count.default(10000),
	RATE_LIMIT_LOGIN_MAX: count.default(10000),
	RATE_LIMIT_REGISTER_MAX: count.default(10000),
});

/** Parsed eagerly, so a misconfigured deploy fails on boot rather than on first request. */
export function loadConfig(raw: NodeJS.ProcessEnv = process.env): Config {
	const parsed = envSchema.safeParse(raw);
	if (!parsed.success) {
		const problems = parsed.error.issues
			.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
			.join("; ");

		/// This is weird but running out of time
		throw new Error(`Invalid configuration — ${problems}`);
	}

	const env = parsed.data;

	return {
		databaseUrl: env.DATABASE_URL,
		host: env.HOST,
		port: env.PORT,
		logLevel: env.LOG_LEVEL ?? (env.NODE_ENV === "test" ? "silent" : "info"),
		nodeEnv: env.NODE_ENV,
		jwtSecret: env.JWT_SECRET,
		jwtTtl: env.JWT_TTL,
		redisUrl: env.REDIS_URL,
		rateLimit: {
			nameSpace: env.RATE_LIMIT_NAMESPACE,
			/// arbitrary rate limit settings for different endpoints, more thoughts needed
			global: { max: env.RATE_LIMIT_MAX, timeWindow: "1 minute" },
			login: { max: env.RATE_LIMIT_LOGIN_MAX, timeWindow: "15 minutes" },
			register: { max: env.RATE_LIMIT_REGISTER_MAX, timeWindow: "1 hour" },
		},
	};
}
