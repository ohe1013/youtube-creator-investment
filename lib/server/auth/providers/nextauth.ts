import "server-only";

import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { AuthPrincipal } from "@/lib/server/auth/types";

type BrowserSession = { user?: { id?: string } | null } | null;
type BrowserUser = { id: string; role: "USER" | "ADMIN" } | null;

export type NextAuthPrincipalDependencies = {
  getSession: () => Promise<BrowserSession>;
  findUser: (userId: string) => Promise<BrowserUser>;
};

const defaultDependencies: NextAuthPrincipalDependencies = {
  getSession: () => getServerSession(authOptions),
  findUser: (userId) =>
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    }),
};

/** Resolves a browser session to the current, database-owned user role. */
export async function resolveNextAuthPrincipal(
  dependencies: NextAuthPrincipalDependencies = defaultDependencies,
): Promise<AuthPrincipal | null> {
  const session = await dependencies.getSession();
  const user = session?.user;

  if (!user?.id) return null;
  const databaseUser = await dependencies.findUser(user.id);
  if (!databaseUser) return null;

  return {
    userId: databaseUser.id,
    provider: "google",
    role: databaseUser.role,
  };
}

/** Resolves the database-backed NextAuth browser session, if any. */
export function authenticateNextAuthRequest(): Promise<AuthPrincipal | null> {
  return resolveNextAuthPrincipal();
}
