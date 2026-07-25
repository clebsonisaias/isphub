import { PrismaClient } from "@prisma/client";

/** Instancia unica do Prisma Client, reaproveitada em toda a API. */
export const prisma = new PrismaClient();
