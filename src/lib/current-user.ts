export interface AuthenticatedUser {
  id: string;
  email: string | null;
  name: string | null;
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const { auth } = await import("@/auth");
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
  };
}
