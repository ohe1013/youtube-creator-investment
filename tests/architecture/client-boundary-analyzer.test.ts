import { describe, expect, it } from "vitest";

import * as boundaryAnalyzer from "@/tests/architecture/client-boundary-analyzer";

const { analyzeClientBoundaries } = boundaryAnalyzer;

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

  it.each(["SessionProvider", "useSession", "getSession", "signOut"])(
    "rejects %s imported outside the normalized adapter",
    (name) => {
      expect(
        rules({
          "components/root.tsx": `import { ${name} as forbidden } from "next-auth/react";`,
        }),
      ).toContain("components/root.tsx:nextauth-session-import");
    },
  );

  it.each([
    'export { useSession as normalized } from "next-auth/react";',
    'export { getSession as escaped } from "next-auth/react";',
    'export * from "next-auth/react";',
    'const auth = import("next-auth/react");',
    'const auth = import(`next-auth/react`);',
    'const auth = require("next-auth/react");',
    'const auth = require(`next-auth/react`);',
  ])("rejects a NextAuth escape outside the adapter: %s", (source) => {
    expect(rules({ "lib/auth-escape.ts": source })).toContain(
      "lib/auth-escape.ts:nextauth-session-import",
    );
  });

  it("allows the browser sign-in import without exposing session state", () => {
    expect(
      rules({
        "app/auth/signin/page.tsx":
          'import { signIn } from "next-auth/react"; export const login = signIn;',
      }),
    ).toEqual([]);
  });

  it("allows NextAuth access only inside the normalized session adapter", () => {
    expect(
      rules({
        "lib/session/CreatorXSessionProvider.tsx": [
          'export * from "next-auth/react";',
          'const dynamicAuth = import("next-auth/react");',
          'const commonJsAuth = require("next-auth/react");',
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it("resolves a .js import specifier to a project TypeScript helper", () => {
    expect(
      rules({
        "components/root.tsx":
          '"use client"; import { load } from "../lib/helper.js"; export const Root = load;',
        "lib/helper.ts":
          'export const load = () => globalThis.fetch("/api/portfolio");',
      }),
    ).toContain("lib/helper.ts:client-fetch");
  });

  it.each([
    ["../lib/helper.mjs", "lib/helper.mts"],
    ["../lib/helper.cjs", "lib/helper.cts"],
  ])(
    "maps the authored %s specifier to %s",
    (specifier, implementationPath) => {
      expect(
        rules({
          "components/root.tsx":
            `"use client"; import { load } from "${specifier}"; export const Root = load;`,
          [implementationPath]:
            'export const load = () => globalThis.fetch("/api/portfolio");',
        }),
      ).toContain(`${implementationPath}:client-fetch`);
    },
  );

  it.each([
    'const helper = require("../lib/helper.js"); export const Root = helper;',
    'const helper = require(`../lib/helper.js`); export const Root = helper;',
    'export { load } from `../lib/helper.js`;',
    'void import(`../lib/helper.js`);',
  ])("follows CommonJS and template module edges: %s", (edge) => {
    expect(
      rules({
        "components/root.cjs": `"use client"; ${edge}`,
        "lib/helper.ts":
          'export const load = () => globalThis.fetch("/api/portfolio");',
      }),
    ).toContain("lib/helper.ts:client-fetch");
  });

  it.each(["mts", "cts", "js", "jsx", "mjs", "cjs"])(
    "parses client graph sources with the .%s extension",
    (extension) => {
      expect(
        rules({
          [`components/root.${extension}`]:
            '"use client"; globalThis.fetch("/api/portfolio");',
        }),
      ).toContain(`components/root.${extension}:client-fetch`);
    },
  );

  it("rejects computed global fetch access and reassignment", () => {
    expect(
      rules({
        "components/access.tsx":
          '"use client"; const key = "fetch"; globalThis[key]("/api/portfolio");',
        "lib/reassign.ts":
          'const key = `fetch`; window[key] = replacement;',
      }),
    ).toEqual(
      expect.arrayContaining([
        "components/access.tsx:client-fetch",
        "lib/reassign.ts:fetch-reassignment",
      ]),
    );
  });

  it("rejects computed fetch through a global-object alias", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          "const browser = globalThis;",
          'const key = "fetch";',
          'const request = browser[key]; request("/api/portfolio");',
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it("keeps fetch shadowing lexical instead of hiding a top-level global fetch", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          'function local(fetch: (url: string) => unknown) { return fetch("local"); }',
          'fetch("/api/portfolio");',
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it("does not flag a lexically shadowed local fetch parameter", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          'export function local(fetch: (url: string) => unknown) { return fetch("local"); }',
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it("updates computed string facts in statement order", () => {
    expect(
      rules({
        "components/safe.tsx": [
          '"use client";',
          'let key = "fetch";',
          'key = "postMessage";',
          'globalThis[key]("safe");',
        ].join("\n"),
        "components/forbidden.tsx": [
          '"use client";',
          'let key = "postMessage";',
          'key = "fetch";',
          'globalThis[key]("/api/portfolio");',
        ].join("\n"),
      }),
    ).toEqual(["components/forbidden.tsx:client-fetch"]);
  });

  it("updates global-object aliases in statement order", () => {
    expect(
      rules({
        "components/safe.tsx": [
          '"use client";',
          "const localApi = { fetch() { return 1; } };",
          "let target = globalThis;",
          "target = localApi;",
          "target.fetch();",
        ].join("\n"),
        "components/forbidden.tsx": [
          '"use client";',
          "const localApi = {};",
          "let target = localApi;",
          "target = globalThis;",
          'target.fetch("/api/portfolio");',
        ].join("\n"),
      }),
    ).toEqual(["components/forbidden.tsx:client-fetch"]);
  });

  it("retains a possible fetch key after branch assignment merging", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          'let key = "postMessage";',
          'if (enabled) key = "fetch";',
          'globalThis[key]("/api/portfolio");',
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it.each(["globalThis", "window", "self"])(
    "rejects fetch destructured from %s",
    (globalObject) => {
      expect(
        rules({
          "components/root.tsx": [
            '"use client";',
            `const { fetch: request } = ${globalObject};`,
            'request("/api/portfolio");',
          ].join("\n"),
        }),
      ).toContain("components/root.tsx:client-fetch");
    },
  );

  it.each([
    'self.fetch("/api/portfolio")',
    'self["fetch"]("/api/portfolio")',
    'Reflect.get(globalThis, "fetch")("/api/portfolio")',
    'const key = "fetch"; const request = Reflect.get(window, key); request("/api/portfolio")',
  ])("rejects global fetch capability access: %s", (source) => {
    expect(
      rules({
        "components/root.tsx": `"use client"; ${source};`,
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it.each([
    'Object.defineProperty(globalThis, "fetch", { value: replacement });',
    'const key = "fetch"; Object.defineProperty(window, key, { value: replacement });',
    'const key = "fetch"; Object.defineProperties(self, { [key]: { value: replacement } });',
    'Object.defineProperties(globalThis, { fetch: { value: replacement } });',
  ])("rejects global fetch descriptor reassignment: %s", (source) => {
    expect(rules({ "lib/mutator.ts": source })).toContain(
      "lib/mutator.ts:fetch-reassignment",
    );
  });

  it("does not flag local destructuring, Reflect access, descriptors, or shadowed intrinsics", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          "const localApi = { fetch() { return 1; } };",
          "const { fetch: request } = localApi;",
          "request();",
          'Reflect.get(localApi, "fetch")();',
          'Object.defineProperty(localApi, "fetch", { value: request });',
          'Object.defineProperties(globalThis, { postMessage: { value: request } });',
          'function shadow(Object: unknown, Reflect: unknown) { return [Object, Reflect]; }',
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it("does not confuse local fetch-named properties or non-fetch computed globals", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          "const localApi = { fetch() { return 1; } };",
          "localApi.fetch();",
          'const key = "postMessage";',
          'globalThis[key]("safe");',
        ].join("\n"),
        "app/api/example/route.mts":
          'const key = "fetch"; export const GET = () => globalThis[key]("https://example.com");',
      }),
    ).toEqual([]);
  });

  it.each([
    ["app/page.tsx", true],
    ["components/widget.jsx", true],
    ["lib/helper.mts", true],
    ["hooks/use-helper.cts", true],
    ["services/client.ts", true],
    ["utils/request.mjs", true],
    ["src/runtime/client.cjs", true],
    ["types/contracts.ts", true],
    ["middleware.mjs", true],
    ["root-helper.cjs", true],
    ["scripts/helper.js", false],
    ["prisma/seed.ts", false],
    ["app/api/example/route.ts", false],
    ["lib/youtube.ts", false],
    ["node_modules/pkg/index.js", false],
    [".next/server/app.js", false],
    ["out/runtime.js", false],
    ["next-env.d.ts", false],
    ["tests/helper.ts", false],
    ["src/__tests__/helper.ts", false],
    ["components/widget.test.tsx", false],
    ["lib/helper.spec.js", false],
  ] as const)("classifies project source %s", (path, expected) => {
    const classify = (
      boundaryAnalyzer as typeof boundaryAnalyzer & {
        isProjectOwnedSourcePath?: (candidate: string) => boolean;
      }
    ).isProjectOwnedSourcePath;
    expect(classify?.(path)).toBe(expected);
  });

  it("follows aliased and relative imports through services, utils, src, and root helpers", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          'import { service } from "@/services/client.js";',
          "export const Root = service;",
        ].join("\n"),
        "services/client.ts":
          'export { request as service } from "../utils/request.mjs";',
        "utils/request.mts":
          'export { request } from "../src/client-helper.js";',
        "src/client-helper.ts":
          'export { request } from "../root-helper.cjs";',
        "root-helper.cts":
          'export const request = () => globalThis.fetch("/api/portfolio");',
      }),
    ).toContain("root-helper.cts:client-fetch");
  });

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
