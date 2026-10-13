/**
 * The slice of a logger the domain needs. `request.log` satisfies it
 * structurally, so handlers can pass their request-scoped logger down and keep
 * correlation ids, without the domain importing anything from Fastify.
 */
export interface DomainLogger {
	error(context: Record<string, unknown>, message: string): void;
	warn(context: Record<string, unknown>, message: string): void;
}
