import { prisma } from "@/lib/prisma";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readBuildRevision() {
  const revision = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  return revision && /^[a-f0-9]{7,64}$/i.test(revision) ? revision : "unknown";
}

export const GET = withApiRoute(async () => {
  const revision = readBuildRevision();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      { status: "ok", revision },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable", revision },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
});

export const OPTIONS = corsPreflight;
