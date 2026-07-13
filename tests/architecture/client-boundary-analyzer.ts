import { posix } from "node:path";
import ts from "typescript";

export type BoundaryViolation = {
  path: string;
  rule: "client-fetch" | "fetch-reassignment" | "nextauth-session-import";
};

const SESSION_ADAPTER = "lib/session/CreatorXSessionProvider.tsx";
const SIGNIN_ADAPTER = "app/auth/signin/page.tsx";
const CLIENT_FETCH_ALLOWLIST = new Set([
  "lib/data/remote-client.ts",
  "lib/data/toss-login-client.ts",
]);
const SESSION_ADAPTER_IMPORTS = new Set([
  "SessionProvider",
  "getSession",
  "signOut",
  "useSession",
]);
const SIGNIN_ADAPTER_IMPORTS = new Set(["signIn"]);
const GLOBAL_OBJECT_NAMES = new Set([
  "global",
  "globalThis",
  "self",
  "window",
]);
const MUTATION_CAPABILITY_NAMES = new Set([
  "assign",
  "defineProperties",
  "defineProperty",
  "deleteProperty",
  "set",
]);
const GENERATED_OR_EXTERNAL_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".superpowers",
  "__tests__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "prisma",
  "scripts",
  "tests",
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
const TEST_SOURCE_PATTERN =
  /\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

type ParsedSource = {
  imports: string[];
  sourceFile: ts.SourceFile;
};

type RuntimeSyntaxFacts = {
  apiToken: boolean;
  callWithFetchArgument: boolean;
  callWithGlobalArgument: boolean;
  fetchMutationTarget: boolean;
  fetchToken: boolean;
  globalMutation: boolean;
  globalToken: boolean;
  mutationCapability: boolean;
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
  if (
    normalized === "next-env.d.ts" ||
    segments.some((segment) => GENERATED_OR_EXTERNAL_DIRECTORIES.has(segment))
  ) {
    return false;
  }
  if (
    /^app\/api\/.+\/route\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(
      normalized,
    )
  ) {
    return false;
  }
  if (/^lib\/youtube(?:\/|\.)/.test(normalized)) return false;
  return true;
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
  if ((!isDynamicImport && !isRequire) || node.arguments.length < 1) {
    return null;
  }
  return staticModuleText(node.arguments[0]);
}

function isTypeOnlyModuleDeclaration(
  node: ts.ImportDeclaration | ts.ExportDeclaration,
): boolean {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (clause?.isTypeOnly) return true;
    return Boolean(
      clause &&
        !clause.name &&
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.length > 0 &&
        clause.namedBindings.elements.every((element) => element.isTypeOnly),
    );
  }
  if (node.isTypeOnly) return true;
  return Boolean(
    node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.length > 0 &&
      node.exportClause.elements.every((element) => element.isTypeOnly),
  );
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      !isTypeOnlyModuleDeclaration(node)
    ) {
      const specifier = staticModuleText(node.moduleSpecifier);
      if (specifier !== null) specifiers.add(specifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
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

function hasDeclareModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword),
  );
}

function isBodylessFunctionLike(node: ts.Node): boolean {
  return (
    ((ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isConstructorDeclaration(node)) &&
      node.body === undefined) ||
    ts.isMethodSignature(node) ||
    ts.isCallSignatureDeclaration(node) ||
    ts.isConstructSignatureDeclaration(node) ||
    ts.isFunctionTypeNode(node)
  );
}

function containsGlobalObjectToken(node: ts.Node): boolean {
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (found) return;
    if (
      ts.isIdentifier(candidate) &&
      GLOBAL_OBJECT_NAMES.has(candidate.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function containsRuntimeFetchToken(node: ts.Node): boolean {
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (found || ts.isTypeNode(candidate)) return;
    if (
      ((ts.isIdentifier(candidate) || ts.isPrivateIdentifier(candidate)) &&
        candidate.text === "fetch") ||
      ((ts.isStringLiteralLike(candidate) ||
        ts.isTemplateLiteralToken(candidate)) &&
        candidate.text === "fetch")
    ) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function runtimeSyntaxFacts(sourceFile: ts.SourceFile): RuntimeSyntaxFacts {
  const facts: RuntimeSyntaxFacts = {
    apiToken: false,
    callWithFetchArgument: false,
    callWithGlobalArgument: false,
    fetchMutationTarget: false,
    fetchToken: false,
    globalMutation: false,
    globalToken: false,
    mutationCapability: false,
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isTypeNode(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      hasDeclareModifier(node) ||
      isBodylessFunctionLike(node)
    ) {
      return;
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      isTypeOnlyModuleDeclaration(node)
    ) {
      return;
    }
    if (
      (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) &&
      node.isTypeOnly
    ) {
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && node.isTypeOnly) return;

    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      if (node.text === "fetch") facts.fetchToken = true;
      if (GLOBAL_OBJECT_NAMES.has(node.text)) facts.globalToken = true;
      if (MUTATION_CAPABILITY_NAMES.has(node.text)) {
        facts.mutationCapability = true;
      }
    } else if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateLiteralToken(node)
    ) {
      if (node.text === "fetch") facts.fetchToken = true;
      if (node.text.startsWith("/api")) facts.apiToken = true;
      if (MUTATION_CAPABILITY_NAMES.has(node.text)) {
        facts.mutationCapability = true;
      }
    }

    if (
      ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      if (containsGlobalObjectToken(node.left)) facts.globalMutation = true;
      if (containsRuntimeFetchToken(node.left)) {
        facts.fetchMutationTarget = true;
      }
    }
    if (
      (ts.isPrefixUnaryExpression(node) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken)) ||
      ts.isPostfixUnaryExpression(node)
    ) {
      if (containsRuntimeFetchToken(node.operand)) {
        facts.fetchMutationTarget = true;
      }
    }
    if (ts.isDeleteExpression(node)) {
      if (containsGlobalObjectToken(node.expression)) {
        facts.globalMutation = true;
      }
      if (containsRuntimeFetchToken(node.expression)) {
        facts.fetchMutationTarget = true;
      }
    }
    if (ts.isCallExpression(node)) {
      if (
        node.arguments[0] !== undefined &&
        containsGlobalObjectToken(node.arguments[0])
      ) {
        facts.callWithGlobalArgument = true;
      }
      if (node.arguments.some(containsRuntimeFetchToken)) {
        facts.callWithFetchArgument = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (facts.callWithGlobalArgument && facts.mutationCapability) {
    facts.globalMutation = true;
  }
  if (facts.callWithFetchArgument && facts.mutationCapability) {
    facts.fetchMutationTarget = true;
  }
  return facts;
}

function containsForbiddenClientToken(facts: RuntimeSyntaxFacts): boolean {
  return facts.fetchToken || facts.apiToken;
}

function containsGlobalFetchReassignment(facts: RuntimeSyntaxFacts): boolean {
  return (
    facts.fetchMutationTarget ||
    (facts.fetchToken && facts.globalToken && facts.globalMutation)
  );
}

function isNextAuthReact(node: ts.Node | undefined): boolean {
  return staticModuleText(node) === "next-auth/react";
}

function allowedNextAuthImports(path: string): ReadonlySet<string> {
  if (path === SESSION_ADAPTER) return SESSION_ADAPTER_IMPORTS;
  if (path === SIGNIN_ADAPTER) return SIGNIN_ADAPTER_IMPORTS;
  return new Set();
}

function directNextAuthImportAllowed(
  node: ts.ImportDeclaration,
  path: string,
): boolean {
  if (isTypeOnlyModuleDeclaration(node)) return true;
  const clause = node.importClause;
  if (
    !clause ||
    clause.name ||
    !clause.namedBindings ||
    ts.isNamespaceImport(clause.namedBindings)
  ) {
    return false;
  }
  const runtimeImports = clause.namedBindings.elements.filter(
    (element) => !element.isTypeOnly,
  );
  const allowed = allowedNextAuthImports(path);
  return (
    runtimeImports.length > 0 &&
    runtimeImports.every((element) =>
      allowed.has(element.propertyName?.text ?? element.name.text),
    )
  );
}

function runtimeExpressionReferencesAlias(
  node: ts.Node,
  aliases: ReadonlySet<string>,
): boolean {
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (found || ts.isTypeNode(candidate)) return;
    if (ts.isIdentifier(candidate) && aliases.has(candidate.text)) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function addBindingAliases(
  name: ts.BindingName,
  aliases: Set<string>,
): boolean {
  if (ts.isIdentifier(name)) {
    const size = aliases.size;
    aliases.add(name.text);
    return aliases.size !== size;
  }
  let changed = false;
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      changed = addBindingAliases(element.name, aliases) || changed;
    }
  }
  return changed;
}

function addAssignmentAliases(
  target: ts.Expression,
  aliases: Set<string>,
): boolean {
  if (ts.isParenthesizedExpression(target)) {
    return addAssignmentAliases(target.expression, aliases);
  }
  if (ts.isIdentifier(target)) {
    const size = aliases.size;
    aliases.add(target.text);
    return aliases.size !== size;
  }
  if (ts.isArrayLiteralExpression(target)) {
    let changed = false;
    for (const element of target.elements) {
      if (ts.isOmittedExpression(element)) continue;
      changed = addAssignmentAliases(
        ts.isSpreadElement(element) ? element.expression : element,
        aliases,
      ) || changed;
    }
    return changed;
  }
  if (ts.isObjectLiteralExpression(target)) {
    let changed = false;
    for (const property of target.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        changed = addAssignmentAliases(property.name, aliases) || changed;
      } else if (ts.isPropertyAssignment(property)) {
        changed =
          addAssignmentAliases(property.initializer, aliases) || changed;
      } else if (ts.isSpreadAssignment(property)) {
        changed = addAssignmentAliases(property.expression, aliases) || changed;
      }
    }
    return changed;
  }
  return false;
}

function nextAuthAliasClosure(
  sourceFile: ts.SourceFile,
  importedLocals: ReadonlySet<string>,
): Set<string> {
  const aliases = new Set(importedLocals);
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (ts.isTypeNode(node)) return;
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        runtimeExpressionReferencesAlias(node.initializer, aliases)
      ) {
        changed = addBindingAliases(node.name, aliases) || changed;
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        runtimeExpressionReferencesAlias(node.right, aliases)
      ) {
        changed = addAssignmentAliases(node.left, aliases) || changed;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return aliases;
}

function bindingContainsAlias(
  name: ts.BindingName,
  aliases: ReadonlySet<string>,
): boolean {
  if (ts.isIdentifier(name)) return aliases.has(name.text);
  return name.elements.some(
    (element) =>
      ts.isBindingElement(element) &&
      bindingContainsAlias(element.name, aliases),
  );
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function callCarriesNextAuthModule(node: ts.CallExpression): boolean {
  return node.arguments.some(
    (argument) => staticModuleText(argument) === "next-auth/react",
  );
}

function containsRestrictedNextAuthAccess(
  sourceFile: ts.SourceFile,
  path: string,
): boolean {
  const importedLocals = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !isNextAuthReact(statement.moduleSpecifier) ||
      isTypeOnlyModuleDeclaration(statement)
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name) importedLocals.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      importedLocals.add(clause.namedBindings.name.text);
    } else if (
      clause?.namedBindings &&
      ts.isNamedImports(clause.namedBindings)
    ) {
      for (const element of clause.namedBindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (
          !element.isTypeOnly &&
          SESSION_ADAPTER_IMPORTS.has(importedName)
        ) {
          importedLocals.add(element.name.text);
        }
      }
    }
  }

  const aliases = nextAuthAliasClosure(sourceFile, importedLocals);

  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isImportDeclaration(node) && isNextAuthReact(node.moduleSpecifier)) {
      if (!directNextAuthImportAllowed(node, path)) found = true;
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (
        isNextAuthReact(node.moduleSpecifier) &&
        !isTypeOnlyModuleDeclaration(node)
      ) {
        found = true;
        return;
      }
      if (
        node.moduleSpecifier === undefined &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.some(
          (element) =>
            !element.isTypeOnly &&
            aliases.has(
              element.propertyName?.text ?? element.name.text,
            ),
        )
      ) {
        found = true;
        return;
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isNextAuthReact(node.moduleReference.expression)
    ) {
      found = true;
      return;
    } else if (
      ts.isCallExpression(node) &&
      callCarriesNextAuthModule(node)
    ) {
      found = true;
      return;
    } else if (
      ts.isExportAssignment(node) &&
      runtimeExpressionReferencesAlias(node.expression, aliases)
    ) {
      found = true;
      return;
    } else if (
      ts.isVariableStatement(node) &&
      hasExportModifier(node) &&
      node.declarationList.declarations.some((declaration) =>
        bindingContainsAlias(declaration.name, aliases),
      )
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
    Object.entries(sources).map(([path, source]) => [
      normalizePath(path),
      source,
    ]),
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
    if (containsRestrictedNextAuthAccess(value.sourceFile, path)) {
      add(path, "nextauth-session-import");
    }
    const facts = runtimeSyntaxFacts(value.sourceFile);
    if (containsGlobalFetchReassignment(facts)) {
      add(path, "fetch-reassignment");
    }
    if (
      clientGraph.has(path) &&
      !CLIENT_FETCH_ALLOWLIST.has(path) &&
      containsForbiddenClientToken(facts)
    ) {
      add(path, "client-fetch");
    }
  }

  return violations.sort((left, right) =>
    `${left.path}:${left.rule}`.localeCompare(
      `${right.path}:${right.rule}`,
    ),
  );
}
