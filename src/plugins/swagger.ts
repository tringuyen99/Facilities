import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import {
	jsonSchemaTransform,
	jsonSchemaTransformObject,
} from "fastify-type-provider-zod";

export async function setupSwagger(app: FastifyInstance): Promise<void> {
	await app.register(swagger, {
		openapi: {
			openapi: "3.1.0",
			info: {
				title: "Facility Search API",
				description: "Search and filter fitness facilities.",
				version: "1.0.0",
			},
			// Swagger UI renders tag groups in this order, so it reads as the order
			// you would actually use the API: check it is up, get a token, search.

			/// Make this automatic somehow? manually defining tags is annoying and error prone
			tags: [
				{ name: "system", description: "Operational endpoints" },
				{ name: "auth", description: "Account creation and token issuance" },
				{ name: "facilities", description: "Search and retrieve facilities" },
			],
			components: {
				securitySchemes: {
					bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
				},
			},
		},
		// Converts the zod schemas on each route into OpenAPI definitions.
		transform: jsonSchemaTransform,
		transformObject: jsonSchemaTransformObject,
	});

	await app.register(async (scope) => {
		scope.addHook("onRoute", (routeOptions) => {
			routeOptions.config = {
				...routeOptions.config,
				public: true,
				rateLimit: false,
			};
		});

		await scope.register(swaggerUi, {
			routePrefix: "/docs",
			uiConfig: { docExpansion: "list", deepLinking: true },
		});
	});
}
