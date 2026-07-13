import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export function isPrismaWriteConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

  return error.code === "P2034" || (error.code === "P2010" && error.meta?.code === "40001");
}

export async function withSerializableRetry<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const attempts = 3;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 10_000,
      });
    } catch (error) {
      if (!isPrismaWriteConflict(error) || attempt === attempts - 1) throw error;
    }
  }

  throw new Error("unreachable serializable transaction state");
}

export async function acquireCreatorAdvisoryLock(
  tx: Prisma.TransactionClient,
  creatorId: string,
) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${creatorId}, 0))
  `;
}
