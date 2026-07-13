import { z } from "zod";

export const creatorXSessionTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int().positive(),
});

export type CreatorXSessionTokens = z.infer<typeof creatorXSessionTokensSchema>;

export const createGuestSessionRequestSchema = z
  .object({
    anonymousKey: z.string().trim().min(1).max(512),
  })
  .strip();

export const refreshCreatorXSessionRequestSchema = z
  .object({
    refreshToken: z.string().trim().min(1).max(512),
  })
  .strip();
