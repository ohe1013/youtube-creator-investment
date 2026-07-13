export type AuthProvider = "google" | "guest" | "toss";

export interface AuthPrincipal {
  userId: string;
  sessionId?: string;
  provider: AuthProvider;
  role: "USER" | "ADMIN";
}
