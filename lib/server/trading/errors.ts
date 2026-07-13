import "server-only";

import { ApiError } from "@/lib/server/http/api-error";

export class TradingServiceError extends ApiError {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(status, code, message, details);
    this.name = "TradingServiceError";
  }
}
