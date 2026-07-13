import type { DefaultSession } from "next-auth";
import type { Prisma, UserRole } from "@prisma/client";

declare module "next-auth" {
  interface User {
    balance: Prisma.Decimal;
    role: UserRole;
  }

  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      balance: string;
      role: UserRole;
    };
  }
}
