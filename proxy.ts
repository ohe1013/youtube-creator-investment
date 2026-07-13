import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readServerEnv } from "@/lib/config/server-env";
import { toErrorResponse } from "@/lib/server/http/api-error";
import {
  applyCorsHeaders,
  assertCorsOriginAllowed,
  resolveAllowedOrigins,
  withCors,
} from "@/lib/server/http/cors";
import {
  assertSecureTransport,
  resolveRequestId,
} from "@/lib/server/http/route-handler";

export function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request);
  let allowedOrigin: string | null = null;

  try {
    const serverEnv = readServerEnv();
    const allowedOrigins = resolveAllowedOrigins({
      isProduction: serverEnv.isProduction,
      developmentOrigins: serverEnv.developmentCorsOrigins,
    });
    allowedOrigin = assertCorsOriginAllowed(request, allowedOrigins);
    assertSecureTransport(
      request,
      serverEnv.isProduction,
      serverEnv.trustForwardedProto,
    );

    if (request.method === "OPTIONS") {
      const response = new NextResponse(null, {
        status: 204,
        headers: {
          allow: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "access-control-max-age": "600",
          "x-request-id": requestId,
        },
      });
      applyCorsHeaders(response.headers, allowedOrigin);
      return response;
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-request-id", requestId);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("x-request-id", requestId);
    applyCorsHeaders(response.headers, allowedOrigin);
    return response;
  } catch (error) {
    return withCors(toErrorResponse(error, requestId), allowedOrigin);
  }
}

export const config = { matcher: "/api/:path*" };
