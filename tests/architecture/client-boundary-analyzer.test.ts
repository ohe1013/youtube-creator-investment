import { describe, expect, it } from "vitest";

import { analyzeClientBoundaries } from "@/tests/architecture/client-boundary-analyzer";

function rules(sources: Record<string, string>): string[] {
  return analyzeClientBoundaries(sources).map(
    ({ path, rule }) => `${path}:${rule}`,
  );
}

describe("client boundary mutation probes", () => {
  it("follows a no-semicolon client directive into a helper with a variable API URL", () => {
    expect(
      rules({
        "components/root.tsx":
          '"use client"\nimport { load } from "../lib/helper"; export const Root = load;',
        "lib/helper.ts":
          'const url = "/api/portfolio"; export const load = () => fetch(url);',
      }),
    ).toContain("lib/helper.ts:client-fetch");
  });

  it("rejects a fetch alias in a client module", () => {
    expect(
      rules({
        "components/root.tsx":
          '"use client"; const request = fetch; request("/api/portfolio");',
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it.each([
    'window["fetch"]("/api/portfolio")',
    "globalThis['fetch']('/api/portfolio')",
    'global["fetch"]("/api/portfolio")',
  ])("rejects bracket global fetch: %s", (expression) => {
    expect(
      rules({
        "components/root.tsx": `"use client"\n${expression};`,
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it("rejects bracket global fetch reassignment", () => {
    expect(
      rules({
        "lib/mutator.ts": 'window["fetch"] = replacement;',
      }),
    ).toContain("lib/mutator.ts:fetch-reassignment");
  });

  it.each(["SessionProvider", "useSession", "signOut"])(
    "rejects %s imported outside the normalized adapter",
    (name) => {
      expect(
        rules({
          "components/root.tsx": `import { ${name} as forbidden } from "next-auth/react";`,
        }),
      ).toContain("components/root.tsx:nextauth-session-import");
    },
  );

  it("does not flag server routes or the explicit RemoteDataClient boundary", () => {
    expect(
      rules({
        "app/api/example/route.ts":
          'const url = "/api/server-only"; export const GET = () => fetch(url);',
        "components/root.tsx":
          '"use client"\nimport { RemoteDataClient } from "../lib/data/remote-client"; export const client = RemoteDataClient;',
        "lib/data/remote-client.ts":
          'export class RemoteDataClient { request(url: string) { return fetch(url); } }',
      }),
    ).toEqual([]);
  });
});
