import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async session({ session, user }: any) {
      if (session.user) {
        session.user.id = user.id;
        session.user.balance = user.balance;
        session.user.role = user.role;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      // Set initial budget when user is created
      await prisma.user.update({
        where: { id: user.id },
        data: {
          initialBudget: 100000,
          balance: 100000,
          role: "USER",
        },
      });
    },
  },
  session: {
    strategy: "database",
  },
  pages: {
    signIn: "/auth/signin",
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
