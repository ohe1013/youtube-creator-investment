import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    balance: number;
    role: "USER" | "ADMIN";
  }

  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      balance: number;
      role: "USER" | "ADMIN";
    };
  }
}
