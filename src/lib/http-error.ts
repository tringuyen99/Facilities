import { STATUS_CODES } from "node:http";
import { z } from "zod";

const errorShape = z.object({
	error: z.string().describe("HTTP reason phrase"),
	message: z.string(),
	statusCode: z.number().int().min(100).max(599),
});

export function errorResponse(status: number) {
	return errorShape
		.extend({ statusCode: z.literal(status) })
		.meta({ id: `${status}Error` });
}

type HttpError = z.infer<typeof errorShape>;

export function httpError(statusCode: number, message: string): HttpError {
	return {
		error: STATUS_CODES[statusCode] ?? "Error",
		message,
		statusCode,
	};
}
