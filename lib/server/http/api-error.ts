import type { ApiErrorBody } from "@/lib/contracts/api";

const INTERNAL_ERROR_MESSAGE = "요청을 처리하지 못했습니다.";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly safeToExpose = status < 500,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function readRetryAfterSeconds(details: unknown) {
  if (!details || typeof details !== "object") return null;
  const value = Reflect.get(details, "retryAfterSeconds");
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

export function toErrorResponse(error: unknown, requestId: string) {
  const isPublicError = error instanceof ApiError && error.safeToExpose;
  const status = isPublicError ? error.status : 500;
  const body: ApiErrorBody = {
    error: {
      code: isPublicError ? error.code : "INTERNAL_SERVER_ERROR",
      message: isPublicError ? error.message : INTERNAL_ERROR_MESSAGE,
      requestId,
      ...(isPublicError && error.details !== undefined
        ? { details: error.details }
        : {}),
    },
  };
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
  });

  if (isPublicError && error.code === "RATE_LIMITED") {
    const retryAfterSeconds = readRetryAfterSeconds(error.details);
    if (retryAfterSeconds !== null) {
      headers.set("retry-after", String(retryAfterSeconds));
    }
  }
  if (isPublicError && error.code === "HTTPS_REQUIRED") {
    headers.set("upgrade", "TLS/1.2");
  }

  return new Response(JSON.stringify(body), { status, headers });
}
