import { posix } from "node:path";
import ts from "typescript";

export type BoundaryViolation = {
  path: string;
  rule: "client-fetch" | "fetch-reassignment" | "nextauth-session-import";
};

const SESSION_ADAPTER = "lib/session/CreatorXSessionProvider.tsx";
const CLIENT_FETCH_ALLOWLIST = new Set(["lib/data/remote-client.ts"]);
const RESTRICTED_NEXTAUTH_IMPORTS = new Set([
  "SessionProvider",
  "signOut",
  "useSession",
]);

type ParsedSource = {
  imports: string[];
  sourceFile: ts.SourceFile;
};

function normalizePath(path: string): string {
  return posix.normalize(path.replaceAll("\\", "/").replace(/^\.\//, ""));
}

function scriptKind(path: string): ts.ScriptKind {
  return path.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : path.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS;
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function resolveLocalImport(
  importer: string,
  specifier: string,
  paths: Set<string>,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = normalizePath(specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = normalizePath(posix.join(posix.dirname(importer), specifier));
  } else {
    return null;
  }

  const candidates = /\.[cm]?[jt]sx?$/.test(base)
    ? [base]
    : [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.mts`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
      ];
  return candidates.find((candidate) => paths.has(candidate)) ?? null;
}

function hasClientDirective(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

function isFetchAccess(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return node.text === "fetch";
  if (ts.isPropertyAccessExpression(node)) return node.name.text === "fetch";
  return (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === "fetch"
  );
}

function containsFetchAccess(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (isFetchAccess(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function containsFetchReassignment(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isFetchAccess(node.left)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function importsRestrictedNextAuth(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "next-auth/react"
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) return true;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (RESTRICTED_NEXTAUTH_IMPORTS.has(importedName)) return true;
      }
    }
  }
  return false;
}

export function analyzeClientBoundaries(
  sources: Record<string, string>,
): BoundaryViolation[] {
  const normalizedSources = new Map(
    Object.entries(sources).map(([path, source]) => [normalizePath(path), source]),
  );
  const paths = new Set(normalizedSources.keys());
  const parsed = new Map<string, ParsedSource>();
  for (const [path, source] of normalizedSources) {
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(path),
    );
    parsed.set(path, {
      imports: moduleSpecifiers(sourceFile).flatMap((specifier) => {
        const resolved = resolveLocalImport(path, specifier, paths);
        return resolved === null ? [] : [resolved];
      }),
      sourceFile,
    });
  }

  const clientGraph = new Set<string>();
  const pending = [...parsed]
    .filter(([, value]) => hasClientDirective(value.sourceFile))
    .map(([path]) => path);
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || clientGraph.has(path)) continue;
    clientGraph.add(path);
    for (const imported of parsed.get(path)?.imports ?? []) pending.push(imported);
  }

  const violations: BoundaryViolation[] = [];
  const add = (path: string, rule: BoundaryViolation["rule"]) => {
    if (!violations.some((item) => item.path === path && item.rule === rule)) {
      violations.push({ path, rule });
    }
  };

  for (const [path, value] of parsed) {
    if (path !== SESSION_ADAPTER && importsRestrictedNextAuth(value.sourceFile)) {
      add(path, "nextauth-session-import");
    }
    if (containsFetchReassignment(value.sourceFile)) {
      add(path, "fetch-reassignment");
    }
    if (
      clientGraph.has(path) &&
      !CLIENT_FETCH_ALLOWLIST.has(path) &&
      containsFetchAccess(value.sourceFile)
    ) {
      add(path, "client-fetch");
    }
  }

  return violations.sort((left, right) =>
    `${left.path}:${left.rule}`.localeCompare(`${right.path}:${right.rule}`),
  );
}
