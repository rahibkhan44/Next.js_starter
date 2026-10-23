import "server-only";

import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

function createPrismaClient() {
	const adapter = new PrismaBetterSqlite3();
	return new PrismaClient({ adapter });
}

declare global {
	// eslint-disable-next-line no-var
	var __prisma: PrismaClient | undefined;
}

export const prisma = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
	globalThis.__prisma = prisma;
}
