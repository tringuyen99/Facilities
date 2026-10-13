import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const healthSchema = z
	.object({
		status: z.string(),
		uptime: z.number().describe("Seconds since the process started"),
	})
	.meta({ id: "Health" });

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
	app.get(
		"/health",
		{
			config: { public: true, rateLimit: false },
			schema: {
				tags: ["system"],
				summary: "Liveness probe",
				response: { 200: healthSchema },
			},
		},
		async () => ({
			status: "ok",
			uptime: process.uptime(),
		}),
	);
};
