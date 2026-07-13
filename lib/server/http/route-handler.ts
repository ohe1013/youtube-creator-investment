import { randomUUID } from "node:crypto";
import { readServerEnv } from "@/lib/config/server-env";
import { ApiError, toErrorResponse } from "@/lib/server/http/api-error";
import {
  assertCorsOriginAllowed,
  resolveAllowedOrigins,
  withCors,
} from "@/lib/server/http/cors";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type ApiRouteContext = { requestId: string };
export type ApiRouteHandler<TContext extends object = object> = (
  request: Request,
  context: TContext & ApiRouteContext,
) => Promise<Response>;
export type StaticApiRouteHandler = (request: Request) => Promise<Response>;
export type DynamicApiRouteHandler<TContext extends object> = (
  request: Request,
  context: TContext,
) => Promise<Response>;
export type ApiRouteOptions = {
  isProduction?: boolean;
  developmentOrigins?: readonly string[];
  trustForwardedProto?: boolean;
};

export function resolveRequestId(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
}

export function isSecureRequest(
  request: Request,
  trustForwardedProto = false,
) {
  return (
    trustForwardedProto &&
    request.headers.get("x-forwarded-proto") === "https"
  );
}

export function assertSecureTransport(
  request: Request,
  isProduction: boolean,
  trustForwardedProto: boolean,
) {
  if (isProduction && !isSecureRequest(request, trustForwardedProto)) {
    throw new ApiError(
      426,
      "HTTPS_REQUIRED",
      "보안 연결(HTTPS)이 필요합니다.",
    );
  }
}

function resolveOptions(options: ApiRouteOptions) {
  const serverEnv = readServerEnv();
  if (serverEnv.isProduction) {
    return {
      isProduction: true,
      developmentOrigins: serverEnv.developmentCorsOrigins,
      trustForwardedProto: serverEnv.trustForwardedProto,
    };
  }
  return {
    isProduction: options.isProduction ?? false,
    developmentOrigins:
      options.developmentOrigins ?? serverEnv.developmentCorsOrigins,
    trustForwardedProto:
      options.trustForwardedProto ?? serverEnv.trustForwardedProto,
  };
}

export function withApiRoute(
  handler: ApiRouteHandler<object>,
  options?: ApiRouteOptions,
): StaticApiRouteHandler;
export function withApiRoute<TContext extends object>(
  handler: ApiRouteHandler<TContext>,
  options?: ApiRouteOptions,
): DynamicApiRouteHandler<TContext>;
export function withApiRoute<TContext extends object>(
  handler: ApiRouteHandler<TContext>,
  options: ApiRouteOptions = {},
) {
  return async (request: Request, context?: TContext) => {
    const requestId = resolveRequestId(request);
    let allowedOrigin: string | null = null;

    try {
      const resolvedOptions = resolveOptions(options);
      const allowedOrigins = resolveAllowedOrigins(resolvedOptions);
      assertSecureTransport(
        request,
        resolvedOptions.isProduction,
        resolvedOptions.trustForwardedProto,
      );
      allowedOrigin = assertCorsOriginAllowed(request, allowedOrigins);
      const response = await handler(request, {
        ...(context ?? {}),
        requestId,
      } as TContext & ApiRouteContext);
      const headers = new Headers(response.headers);
      headers.set("x-request-id", requestId);
      return withCors(
        new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        }),
        allowedOrigin,
      );
    } catch (error) {
      return withCors(toErrorResponse(error, requestId), allowedOrigin);
    }
  };
}

export function createCorsPreflightHandler(options: ApiRouteOptions = {}) {
  return withApiRoute(async (request) => {
    if (request.method !== "OPTIONS") {
      throw new ApiError(
        405,
        "METHOD_NOT_ALLOWED",
        "허용되지 않은 요청 방식입니다.",
      );
    }
    return new Response(null, {
      status: 204,
      headers: {
        allow: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-max-age": "600",
      },
    });
  }, options);
}

/** Re-export from each API route as `export const OPTIONS = corsPreflight`. */
export const corsPreflight = createCorsPreflightHandler();
