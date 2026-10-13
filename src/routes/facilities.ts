import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
	getFacilityById,
	searchFacilities,
} from "../domain/facilities/operations.ts";
import {
	facilityDetailSchema,
	searchResponseSchema,
} from "../domain/facilities/schemas.ts";
import { errorResponse, httpError } from "../lib/http-error.ts";

// strict(): an unknown param is a 400
const searchQuerySchema = z.strictObject({
	nameContains: z
		.string()
		.max(100)
		.optional()
		.describe("Case-insensitive substring of the facility name"),
	addressContains: z
		.string()
		.max(200)
		.optional()
		.describe("Case-insensitive substring of the address"),
	amenityAnyOf: z
		.union([z.string(), z.array(z.string()).max(20)])
		.transform((value) => (Array.isArray(value) ? value : [value]))
		.optional()
		.describe(
			"Repeatable, max 20. Matches a facility holding ANY one of the listed amenities.",
		),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0),
});

export const facilityRoutes: FastifyPluginAsyncZod = async (app) => {
	app.get(
		"/facilities",
		{
			config: { cache: { maxAge: 60 } },
			schema: {
				tags: ["facilities"],
				summary: "Search facilities",
				description:
					"Filters are ANDed with each other, but the values of `amenityAnyOf` are " +
					"ORed with one another. Text filters are case-insensitive substring matches; " +
					"LIKE wildcards in the value are escaped ",
				querystring: searchQuerySchema,
				response: {
					200: searchResponseSchema,
					400: errorResponse(400),
					401: errorResponse(401),
				},
			},
		},
		async (request) => {
			const { nameContains, addressContains, amenityAnyOf, limit, offset } =
				request.query;
			return searchFacilities(app.prisma, {
				...(nameContains !== undefined && { nameContains }),
				...(addressContains !== undefined && { addressContains }),
				...(amenityAnyOf !== undefined && { amenityAnyOf }),
				limit,
				offset,
			});
		},
	);

	app.get(
		"/facilities/:id",
		{
			config: { cache: { maxAge: 300 } },
			schema: {
				tags: ["facilities"],
				summary: "Get one facility by id",
				params: z.object({ id: z.string().min(1) }),
				response: {
					200: facilityDetailSchema,
					400: errorResponse(400),
					401: errorResponse(401),
					404: errorResponse(404),
				},
			},
		},
		async (request, reply) => {
			const facility = await getFacilityById(app.prisma, request.params.id);

			if (facility === null) {
				return reply
					.status(404)
					.send(httpError(404, `No facility with id "${request.params.id}"`));
			}

			return facility;
		},
	);
};
