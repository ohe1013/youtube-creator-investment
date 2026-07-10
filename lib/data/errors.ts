export type CreatorXErrorCode =
  | "CONFIG_INVALID"
  | "BRIDGE_UNAVAILABLE"
  | "STORAGE_UNAVAILABLE"
  | "SESSION_UNAVAILABLE"
  | "NETWORK_UNAVAILABLE"
  | "REQUEST_REJECTED"
  | "INVALID_RESPONSE"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_SHARES"
  | "ORDER_NOT_FOUND"
  | "IDEMPOTENCY_KEY_REUSED";

export class CreatorXClientError extends Error {
  constructor(
    public readonly code: CreatorXErrorCode,
    public readonly userMessage: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(userMessage);
    this.name = "CreatorXClientError";
  }
}
