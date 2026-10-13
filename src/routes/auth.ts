import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { authenticate, registerUser } from "../domain/users/operations.ts";
import {
	credentialsSchema,
	tokenSchema,
	userSchema,
} from "../domain/users/schemas.ts";
import { errorResponse, httpError } from "../lib/http-error.ts";

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
	app.post(
		"/auth/register",
		{
			config: { public: true, rateLimit: app.config.rateLimit.register },
			schema: {
				tags: ["auth"],
				summary: "Create an account",
				body: credentialsSchema,
				response: {
					201: userSchema,
					400: errorResponse(400),
					409: errorResponse(409),
				},
			},
		},
		async (request, reply) => {
			const result = await registerUser(app.prisma, request.body);

			if (!result.ok) {
				return reply
					.status(409)
					.send(
						httpError(
							409,
							`An account already exists for ${result.error.email}`,
						),
					);
			}

			return reply.status(201).send(result.value);
		},
	);

	app.post(
		"/auth/login",
		{
			config: { public: true, rateLimit: app.config.rateLimit.login },
			schema: {
				tags: ["auth"],
				summary: "Exchange credentials for a token",
				body: credentialsSchema,
				response: {
					200: tokenSchema,
					400: errorResponse(400),
					401: errorResponse(401),
				},
			},
		},
		async (request, reply) => {
			const user = await authenticate(app.prisma, request.body, request.log);

			if (user === null) {
				return reply
					.status(401)
					.send(httpError(401, "Invalid email or password"));
			}

			return {
				token: app.jwt.sign({ sub: user.id, email: user.email }),
				expiresIn: app.config.jwtTtl,
			};
		},
	);
};
