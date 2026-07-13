import { withApiRoute } from "@/lib/server/http/route-handler";

type DynamicRouteContext = {
  params: Promise<{ id: string }>;
};

/** Models Next 16's generated RouteContext SecondArg constraint. */
type Next16SecondArgConstraint<T extends DynamicRouteContext> = T;

export const GET = withApiRoute<DynamicRouteContext>(
  async (_request, context) =>
    Response.json({
      id: (await context.params).id,
      requestId: context.requestId,
    }),
);

export type Next16DynamicRouteSecondArg = Next16SecondArgConstraint<
  Parameters<typeof GET>[1]
>;
