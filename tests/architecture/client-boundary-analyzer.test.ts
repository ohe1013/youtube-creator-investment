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
    'const auth = import("next-auth/react", { with: { type: "json" } });',
    'const auth = require("next-auth/react");',
    'const auth = require(`next-auth/react`);',
    'const r = require; const auth = r("next-auth/react");',
    'const auth = module.require("next-auth/react");',
    'const r = module.require; const auth = r("next-auth/react");',
  ])("rejects a NextAuth escape outside the adapter: %s", (source) => {
    expect(rules({ "lib/auth-escape.ts": source })).toContain(
      "lib/auth-escape.ts:nextauth-session-import",
    );
  });

  it("rejects a getSession re-export outside the normalized adapter", () => {
    expect(
      rules({
        "lib/auth-escape.ts":
          'export { getSession as loadSession } from "next-auth/react";',
      }),
    ).toContain("lib/auth-escape.ts:nextauth-session-import");
  });

  it("allows the browser sign-in import without exposing session state", () => {
    expect(
      rules({
        "app/auth/signin/page.tsx":
          'import { signIn } from "next-auth/react"; export const login = signIn;',
      }),
    ).toEqual([]);
  });

  it("rejects signIn imports outside the exact browser sign-in adapter", () => {
    expect(
      rules({
        "components/login.tsx":
          'import { signIn } from "next-auth/react"; export const login = signIn;',
      }),
    ).toContain("components/login.tsx:nextauth-session-import");
  });

  it("ignores a type-only NextAuth import", () => {
    expect(
      rules({
        "types/auth.ts":
          'import type { Session } from "next-auth/react"; export type AuthSession = Session;',
      }),
    ).toEqual([]);
  });

  it.each([
    [
      "getSession re-export",
      'export { getSession as loadSession } from "next-auth/react";',
    ],
    ["dynamic import", 'const dynamicAuth = import("next-auth/react");'],
    ["CommonJS require", 'const commonJsAuth = require("next-auth/react");'],
  ])(
    "rejects a %s escape from the normalized session adapter",
    (_kind, source) => {
      expect(
        rules({
          "lib/session/CreatorXSessionProvider.tsx": source,
        }),
      ).toContain(
        "lib/session/CreatorXSessionProvider.tsx:nextauth-session-import",
      );
    },
  );

  it("allows direct NextAuth session imports inside the normalized adapter", () => {
    expect(
      rules({
        "lib/session/CreatorXSessionProvider.tsx": [
          'import { SessionProvider, getSession, signOut, useSession } from "next-auth/react";',
          "const normalized = [SessionProvider, getSession, signOut, useSession];",
          "void normalized;",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it.each([
    'const leak = signOut; export { leak };',
    'const first = signOut; const leak = first; export { leak };',
    'export const leak = signOut;',
    'let leak; leak = signOut; export { leak };',
    'const [leak] = [signOut]; export { leak };',
    'let leak; [leak] = [signOut]; export { leak };',
    'let leak; ({ leak } = { leak: signOut }); export { leak };',
  ])("rejects a restricted NextAuth alias re-export: %s", (escape) => {
    expect(
      rules({
        "lib/session/CreatorXSessionProvider.tsx": [
          'import { signOut } from "next-auth/react";',
          escape,
        ].join("\n"),
      }),
    ).toContain(
      "lib/session/CreatorXSessionProvider.tsx:nextauth-session-import",
    );
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
    'void import("../lib/helper.js", { with: { type: "json" } });',
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

  it("does not let a never-called function write hide a later top-level fetch", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          "const localApi = { fetch() { return 1; } };",
          "let target = globalThis;",
          "function neverCalled() { target = localApi; }",
          'target.fetch("/api/portfolio");',
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it("catches a deferred captured write after later local initialization", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          "function arm() { target = globalThis; }",
          "const localApi = { fetch() { return 1; } };",
          "let target = localApi;",
          "arm();",
          'target.fetch("/api/portfolio");',
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it("forbids a lexically shadowed fetch parameter by conservative client policy", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          'export function local(fetch: (url: string) => unknown) { return fetch("local"); }',
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it.each([
    'const endpoint = "/api/portfolio"; request(endpoint);',
    "const endpoint = `/api/portfolio/${id}`; request(endpoint);",
  ])("forbids a static client API token without requiring a fetch call: %s", (source) => {
    expect(
      rules({
        "components/root.tsx": `"use client"; ${source}`,
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it("ignores fetch and API tokens that exist only in type space", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          'type fetch = "/api/private";',
          "interface Contract { fetch: '/api/private' }",
          "export const Root = null;",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it("conservatively forbids fetch tokens even when later overwritten", () => {
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
    ).toEqual([
      "components/forbidden.tsx:client-fetch",
      "components/safe.tsx:client-fetch",
    ]);
  });

  it("conservatively forbids fetch property tokens on local aliases", () => {
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
    ).toEqual([
      "components/forbidden.tsx:client-fetch",
      "components/safe.tsx:client-fetch",
    ]);
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

  it("merges conditional-expression writes before a computed fetch", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          'let key = "postMessage";',
          'enabled ? (key = "fetch") : (key = "postMessage");',
          'globalThis[key]("/api/portfolio");',
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it("merges short-circuit writes before a computed fetch", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          'let key = "fetch";',
          'enabled && (key = "postMessage");',
          'globalThis[key]("/api/portfolio");',
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it("preserves the left-hand possibility across logical assignment", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          'let key = "fetch";',
          'key ||= "postMessage";',
          'globalThis[key]("/api/portfolio");',
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it.each([
    [
      "left-hand reference order",
      'let key = "fetch"; globalThis[key] = (key = "safe", replacement);',
    ],
    [
      "compound string assignment",
      'let key = "fet"; key += "ch"; globalThis[key]("/api/portfolio");',
    ],
  ])("catches a fetch boundary despite %s", (_kind, source) => {
    expect(
      rules({
        "components/root.tsx": `"use client"; ${source}`,
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it("merges switch-case writes before a computed fetch", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          'let key = "postMessage";',
          "switch (mode) {",
          '  case "remote": key = "fetch"; break;',
          '  default: key = "postMessage";',
          "}",
          'globalThis[key]("/api/portfolio");',
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it("catches fetch use on a switch fall-through path", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          "const localApi = { fetch() { return 1; } };",
          "let target = localApi;",
          "switch (mode) {",
          '  case "arm": target = globalThis;',
          '  case "run": target.fetch("/api/portfolio"); break;',
          "}",
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it.each([
    [
      "for increment",
      'for (; enabled; key = "postMessage") { consume(key); }',
    ],
    ["zero-iteration for-of", "for (key of keys) { consume(key); }"],
  ])("retains the pre-loop fetch possibility across a %s", (_kind, loop) => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          'let key = "fetch";',
          loop,
          'globalThis[key]("/api/portfolio");',
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it("catches a fetch fact that would otherwise require multiple loop iterations", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          'let a = "postMessage";',
          'let b = "postMessage";',
          'const c = "fetch";',
          "while (enabled) { a = b; b = c; }",
          'globalThis[a]("/api/portfolio");',
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it("conservatively forbids block-scoped fetch tokens regardless of final value", () => {
    expect(
      rules({
        "components/safe.tsx": [
          '"use client";',
          'var key = "fetch";',
          '{ var key = "postMessage"; }',
          'globalThis[key]("safe");',
        ].join("\n"),
        "components/forbidden.tsx": [
          '"use client";',
          'var key = "postMessage";',
          '{ var key = "fetch"; }',
          'globalThis[key]("/api/portfolio");',
        ].join("\n"),
      }),
    ).toEqual([
      "components/forbidden.tsx:client-fetch",
      "components/safe.tsx:client-fetch",
    ]);
  });

  it("keeps class-static-block var declarations inside their own var scope", () => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          'let key = "fetch";',
          'class Local { static { var key = "postMessage"; consume(key); } }',
          'globalThis[key]("/api/portfolio");',
        ].join("\n"),
      }),
    ).toContain("components/root.tsx:client-fetch");
  });

  it.each([
    [
      "onClick handler",
      '<button onClick={() => fetch("/api/portfolio")}>Load</button>',
    ],
    [
      "spread attribute",
      '<Widget {...{ request: fetch }}>Load</Widget>',
    ],
    [
      "nested child expression",
      '<div><span>{fetch("/api/portfolio")}</span></div>',
    ],
  ])("analyzes fetch inside a JSX %s", (_kind, jsx) => {
    expect(
      rules({
        "components/root.tsx": `"use client"; export const Root = () => ${jsx};`,
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
    'const get = Reflect.get; get(globalThis, "fetch")("/api/portfolio")',
    'const { get } = Reflect; get(self, "fetch")("/api/portfolio")',
  ])("rejects a Reflect.get method alias: %s", (source) => {
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

  it("rejects Object.assign replacement of global fetch", () => {
    expect(
      rules({
        "lib/mutator.ts":
          "Object.assign(globalThis, { fetch: replacement });",
      }),
    ).toContain("lib/mutator.ts:fetch-reassignment");
  });

  it("rejects deletion of global fetch", () => {
    expect(
      rules({
        "lib/mutator.ts": "delete globalThis.fetch;",
      }),
    ).toContain("lib/mutator.ts:fetch-reassignment");
  });

  it("rejects Reflect.deleteProperty deletion of global fetch", () => {
    expect(
      rules({
        "lib/mutator.ts":
          'Reflect.deleteProperty(globalThis, "fetch");',
      }),
    ).toContain("lib/mutator.ts:fetch-reassignment");
  });

  it.each([
    'const root = globalThis; root["fetch"] = replacement;',
    "fetch = replacement;",
    "let fetch = replacement; fetch++;",
    'const root = globalThis; Object.defineProperty(root, "fetch", { value: replacement });',
  ])("conservatively rejects a fetch-named mutation target: %s", (source) => {
    expect(rules({ "lib/mutator.ts": source })).toContain(
      "lib/mutator.ts:fetch-reassignment",
    );
  });

  it.each([
    'const assign = Object.assign; assign(globalThis, { fetch: replacement });',
    'const patch = { fetch: replacement }; Object.assign(globalThis, patch);',
    'const { defineProperty } = Object; defineProperty(window, "fetch", { value: replacement });',
    'const descriptors = { fetch: { value: replacement } }; Object.defineProperties(window, descriptors);',
    'const { deleteProperty: remove } = Reflect; remove(self, "fetch");',
  ])("rejects a global fetch mutation through an intrinsic alias: %s", (source) => {
    expect(rules({ "lib/mutator.ts": source })).toContain(
      "lib/mutator.ts:fetch-reassignment",
    );
  });

  it.each([
    "Object.assign(localApi, { fetch: replacement });",
    "delete localApi.fetch;",
    'Reflect.deleteProperty(localApi, "fetch");',
  ])("conservatively rejects a local fetch mutation target: %s", (source) => {
    expect(
      rules({
        "lib/local-mutator.ts": [
          "const localApi = { fetch() { return 1; } };",
          source,
        ].join("\n"),
      }),
    ).toContain("lib/local-mutator.ts:fetch-reassignment");
  });

  it.each([
    "function shadow(Object: unknown) { Object.assign(globalThis, { fetch: replacement }); }",
    'function shadow(Reflect: unknown) { Reflect.deleteProperty(globalThis, "fetch"); }',
    "const globalThis = localApi; Object.assign(globalThis, { fetch: replacement });",
  ])("conservatively rejects a shadowed global mutation token: %s", (source) => {
    expect(
      rules({
        "lib/local-mutator.ts": [
          "const localApi = { fetch() { return 1; } };",
          source,
        ].join("\n"),
      }),
    ).toContain("lib/local-mutator.ts:fetch-reassignment");
  });

  it("forbids local fetch property names in client code by conservative policy", () => {
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
    ).toContain("components/root.tsx:client-fetch");
  });

  it("forbids local fetch-named properties while server routes stay excluded", () => {
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
    ).toEqual(["components/root.tsx:client-fetch"]);
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
    ["lib/server/youtube/youtube-client.ts", false],
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

  it.each([
    [
      "type-only import",
      'import type { HiddenContract } from "../lib/type-helper";',
    ],
    [
      "type-only export",
      'export type { HiddenContract } from "../lib/type-helper";',
    ],
    [
      "type-only import-equals",
      'import type HiddenContract = require("../lib/type-helper");',
    ],
  ])("does not follow a %s as a runtime client edge", (_kind, edge) => {
    expect(
      rules({
        "components/root.tsx": [
          '"use client";',
          edge,
          "export const Root = null;",
        ].join("\n"),
        "lib/type-helper.ts": [
          "export type HiddenContract = { id: string };",
          'export const hiddenRequest = () => fetch("/api/portfolio");',
        ].join("\n"),
      }),
    ).toEqual([]);
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

  it("allows the dedicated Toss Login typed boundary", () => {
    expect(
      rules({
        "components/root.tsx":
          '"use client"\nimport { TossLoginClient } from "../lib/data/toss-login-client"; export const client = TossLoginClient;',
        "lib/data/toss-login-client.ts":
          'export class TossLoginClient { request(url: string) { return fetch(url); } }',
      }),
    ).toEqual([]);
  });

  it("allows the dedicated CreatorX session rotation boundary", () => {
    expect(
      rules({
        "components/root.tsx":
          '"use client"\nimport { CreatorXSessionClient } from "../lib/data/creatorx-session-client"; export const client = CreatorXSessionClient;',
        "lib/data/creatorx-session-client.ts":
          'export class CreatorXSessionClient { request(url: string) { return fetch(url); } }',
      }),
    ).toEqual([]);
  });
});
