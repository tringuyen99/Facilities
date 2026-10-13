import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

async function main(): Promise<void> {
	const config = loadConfig();
	const app = await buildApp(config);

	let shuttingDown = false;
	const shutdown = async (signal: string): Promise<void> => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;

		app.log.info({ signal }, "shutting down");
		try {
			await app.close();
			process.exit(0);
		} catch (error) {
			app.log.error({ error }, "error during shutdown");
			process.exit(1);
		}
	};

	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		process.on(signal, () => void shutdown(signal));
	}

	process.on("unhandledRejection", (reason) => {
		app.log.fatal({ reason }, "unhandled rejection");
		process.exit(1);
	});

	await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
	// biome-ignore lint/suspicious/noConsole: buildApp may have thrown before the logger existed, so console is the only way to report a failed startup.
	console.error("Failed to start server:", error);
	process.exit(1);
});
