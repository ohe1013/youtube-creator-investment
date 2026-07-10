import { posix } from "node:path";
import ts from "typescript";

export type BoundaryViolation = {
  path: string;
  rule: "client-fetch" | "fetch-reassignment" | "nextauth-session-import";
};

const SESSION_ADAPTER = "lib/session/CreatorXSessionProvider.tsx";
const CLIENT_FETCH_ALLOWLIST = new Set(["lib/data/remote-client.ts"]);
const PROJECT_SOURCE_DIRECTORIES = new Set([
  "app",
  "components",
  "hooks",
  "lib",
]);
const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;
const SOURCE_EXTENSION_PATTERN = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_SOURCE_PATTERN = /\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const RESTRICTED_NEXTAUTH_IMPORTS = new Set([
  "SessionProvider",
  "signOut",
  "useSession",
]);
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "global"]);

type ParsedSource = {
  imports: string[];
  sourceFile: ts.SourceFile;
};

type FetchFacts = {
  globalObjects: Set<string>;
  staticStrings: Map<string, string>;
  shadowsBareFetch: boolean;
};

function normalizePath(path: string): string {
  return posix.normalize(path.replaceAll("\\", "/").replace(/^\.\//, ""));
}

export function isProjectOwnedSourcePath(path: string): boolean {
  const normalized = normalizePath(path);
  if (
    !SOURCE_EXTENSION_PATTERN.test(normalized) ||
    TEST_SOURCE_PATTERN.test(normalized)
  ) {
    return false;
  }
  const segments = normalized.split("/");
  return (
    segments.length === 1 || PROJECT_SOURCE_DIRECTORIES.has(segments[0] ?? "")
  );
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(?:js|mjs|cjs)$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function staticModuleText(node: ts.Node | undefined): string | null {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : null;
}

function callModuleSpecifier(node: ts.CallExpression): string | null {
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire =
    ts.isIdentifier(node.expression) && node.expression.text === "require";
  if ((!isDynamicImport && !isRequire) || node.arguments.length !== 1) {
    return null;
  }
  return staticModuleText(node.arguments[0]);
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      const specifier = staticModuleText(node.moduleSpecifier);
      if (specifier !== null) specifiers.add(specifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const specifier = staticModuleText(node.moduleReference.expression);
      if (specifier !== null) specifiers.add(specifier);
    } else if (ts.isCallExpression(node)) {
      const specifier = callModuleSpecifier(node);
      if (specifier !== null) specifiers.add(specifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...specifiers];
}

function explicitExtensionCandidates(base: string, extension: string): string[] {
  const stem = base.slice(0, -extension.length);
  switch (extension) {
    case ".js":
      return [`${stem}.ts`, `${stem}.tsx`, base, `${stem}.jsx`];
    case ".jsx":
      return [`${stem}.tsx`, `${stem}.ts`, base, `${stem}.js`];
    case ".mjs":
      return [`${stem}.mts`, base];
    case ".cjs":
      return [`${stem}.cts`, base];
    default:
      return [base];
  }
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

  const extension = SOURCE_EXTENSIONS.find((candidate) =>
    base.endsWith(candidate),
  );
  const candidates =
    extension === undefined
      ? [
          base,
          ...SOURCE_EXTENSIONS.map((candidate) => `${base}${candidate}`),
          ...SOURCE_EXTENSIONS.map(
            (candidate) => `${base}/index${candidate}`,
          ),
        ]
      : explicitExtensionCandidates(base, extension);
  return candidates.find((candidate) => paths.has(candidate)) ?? null;
}

function hasClientDirective(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteralLike(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticStringValue(
  expression: ts.Expression,
  values: Map<string, string>,
): string | null {
  const current = unwrapExpression(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  return ts.isIdentifier(current) ? (values.get(current.text) ?? null) : null;
}

function isGlobalObjectExpression(
  expression: ts.Expression,
  aliases: Set<string>,
): boolean {
  const current = unwrapExpression(expression);
  return ts.isIdentifier(current) && aliases.has(current.text);
}

function addBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) addBindingNames(element.name, names);
  }
}

function shadowsBareFetch(sourceFile: ts.SourceFile): boolean {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node)
    ) {
      addBindingNames(node.name, names);
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name
    ) {
      names.add(node.name.text);
    } else if (ts.isImportClause(node) && node.name) {
      names.add(node.name.text);
    } else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
      names.add(node.name.text);
    } else if (ts.isImportEqualsDeclaration(node)) {
      names.add(node.name.text);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      addBindingNames(node.variableDeclaration.name, names);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names.has("fetch");
}

function fetchFacts(sourceFile: ts.SourceFile): FetchFacts {
  const staticStrings = new Map<string, string>();
  const globalObjects = new Set(GLOBAL_OBJECTS);
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const stringValue = staticStringValue(node.initializer, staticStrings);
        if (
          stringValue !== null &&
          staticStrings.get(node.name.text) !== stringValue
        ) {
          staticStrings.set(node.name.text, stringValue);
          changed = true;
        }
        if (
          isGlobalObjectExpression(node.initializer, globalObjects) &&
          !globalObjects.has(node.name.text)
        ) {
          globalObjects.add(node.name.text);
          changed = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return {
    globalObjects,
    staticStrings,
    shadowsBareFetch: shadowsBareFetch(sourceFile),
  };
}

function isDeclarationOrPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ((ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isEnumMember(parent)) &&
      parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent)
  );
}

function isFetchExpression(node: ts.Node, facts: FetchFacts): boolean {
  if (ts.isIdentifier(node)) {
    return (
      node.text === "fetch" &&
      !facts.shadowsBareFetch &&
      !isDeclarationOrPropertyName(node)
    );
  }
  if (ts.isPropertyAccessExpression(node)) {
    return (
      node.name.text === "fetch" &&
      isGlobalObjectExpression(node.expression, facts.globalObjects)
    );
  }
  if (!ts.isElementAccessExpression(node) || node.argumentExpression === undefined) {
    return false;
  }
  return (
    isGlobalObjectExpression(node.expression, facts.globalObjects) &&
    staticStringValue(node.argumentExpression, facts.staticStrings) === "fetch"
  );
}

function containsFetchAccess(
  sourceFile: ts.SourceFile,
  facts: FetchFacts,
): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (isFetchExpression(node, facts)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function containsFetchReassignment(
  sourceFile: ts.SourceFile,
  facts: FetchFacts,
): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isFetchExpression(node.left, facts)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function isNextAuthReact(node: ts.Node | undefined): boolean {
  return staticModuleText(node) === "next-auth/react";
}

function namedExportsRestricted(exports: ts.NamedExports): boolean {
  return exports.elements.some((element) => {
    const exportedName = element.propertyName?.text ?? element.name.text;
    return (
      exportedName === "default" ||
      RESTRICTED_NEXTAUTH_IMPORTS.has(exportedName)
    );
  });
}

function containsRestrictedNextAuthAccess(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isImportDeclaration(node) && isNextAuthReact(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause?.name || (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))) {
        found = true;
        return;
      }
      if (
        clause?.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.some((element) =>
          RESTRICTED_NEXTAUTH_IMPORTS.has(
            element.propertyName?.text ?? element.name.text,
          ),
        )
      ) {
        found = true;
        return;
      }
    } else if (
      ts.isExportDeclaration(node) &&
      isNextAuthReact(node.moduleSpecifier) &&
      (node.exportClause === undefined ||
        ts.isNamespaceExport(node.exportClause) ||
        (ts.isNamedExports(node.exportClause) &&
          namedExportsRestricted(node.exportClause)))
    ) {
      found = true;
      return;
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isNextAuthReact(node.moduleReference.expression)
    ) {
      found = true;
      return;
    } else if (
      ts.isCallExpression(node) &&
      callModuleSpecifier(node) === "next-auth/react"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
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
    if (
      path !== SESSION_ADAPTER &&
      containsRestrictedNextAuthAccess(value.sourceFile)
    ) {
      add(path, "nextauth-session-import");
    }
    const facts = fetchFacts(value.sourceFile);
    if (containsFetchReassignment(value.sourceFile, facts)) {
      add(path, "fetch-reassignment");
    }
    if (
      clientGraph.has(path) &&
      !CLIENT_FETCH_ALLOWLIST.has(path) &&
      containsFetchAccess(value.sourceFile, facts)
    ) {
      add(path, "client-fetch");
    }
  }

  return violations.sort((left, right) =>
    `${left.path}:${left.rule}`.localeCompare(`${right.path}:${right.rule}`),
  );
}
