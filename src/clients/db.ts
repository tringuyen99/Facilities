import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

export function createPrismaClient(url: string): PrismaClient {
	return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
