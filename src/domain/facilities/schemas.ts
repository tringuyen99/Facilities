import { z } from "zod";

const facilitySummarySchema = z
	.object({
		id: z.string(),
		name: z.string(),
		address: z.string(),
		latitude: z.number(),
		longitude: z.number(),
	})
	.meta({ id: "FacilitySummary" });

export const facilityDetailSchema = facilitySummarySchema
	.extend({
		amenities: z.array(z.string()).describe("Amenity names"),
	})
	.meta({ id: "FacilityDetail" });

export const searchResponseSchema = z
	.object({
		data: z.array(facilitySummarySchema),
		pagination: z.object({
			limit: z.number().int().min(1).max(100).meta({ example: 20 }),
			offset: z.number().int().min(0).meta({ example: 0 }),
			hasMore: z.boolean().describe("True when a further page exists"),
		}),
	})
	.meta({ id: "SearchResponse" });

export type FacilityDetail = z.infer<typeof facilityDetailSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
