import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readServerEnv } from "@/lib/config/server-env";
import { ApiError, toErrorResponse } from "@/lib/server/http/api-error";
import {
  isSecureRequest,
  resolveRequestId,
} from "@/lib/server/http/route-handler";

export function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const serverEnv = readServerEnv();
  if (
    serverEnv.isProduction &&
    !isSecureRequest(request, serverEnv.trustForwardedProto)
  ) {
    return toErrorResponse(
      new ApiError(426, "HTTPS_REQUIRED", "보안 연결(HTTPS)이 필요합니다."),
      requestId,
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = { matcher: "/api/:path*" };
