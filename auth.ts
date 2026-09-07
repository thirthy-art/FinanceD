import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/src/db";
import { authAccounts, authSessions, authUsers } from "@/src/db/schema";

export const configuredAuthProviders = [
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
    ? Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
      })
    : null,
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID
    && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
    && process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
    ? MicrosoftEntraID({
        clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
        issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      })
    : null,
].filter((provider) => provider !== null);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(getDb(), {
    usersTable: authUsers,
    accountsTable: authAccounts,
    sessionsTable: authSessions,
  }),
  providers: configuredAuthProviders,
  session: { strategy: "database" },
  pages: { signIn: "/sign-in" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
