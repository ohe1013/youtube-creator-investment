import { posix } from "node:path";
import ts from "typescript";

export type BoundaryViolation = {
  path: string;
  rule: "client-fetch" | "fetch-reassignment" | "nextauth-session-import";
};

const SESSION_ADAPTER = "lib/session/CreatorXSessionProvider.tsx";
const CLIENT_FETCH_ALLOWLIST = new Set(["lib/data/remote-client.ts"]);
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
  "getSession",
  "signOut",
  "useSession",
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

type ParsedSource = {
  imports: string[];
  sourceFile: ts.SourceFile;
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
  if (/^app\/api\/.+\/route\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(normalized)) {
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

type AbstractValue = Readonly<{
  fetchFunction: boolean;
  globalObject: boolean;
  objectIntrinsic: boolean;
  reflectIntrinsic: boolean;
  strings: ReadonlySet<string>;
}>;

type FetchAnalysis = {
  access: boolean;
  reassignment: boolean;
};

const UNKNOWN_VALUE: AbstractValue = {
  fetchFunction: false,
  globalObject: false,
  objectIntrinsic: false,
  reflectIntrinsic: false,
  strings: new Set(),
};
const FETCH_VALUE: AbstractValue = {
  ...UNKNOWN_VALUE,
  fetchFunction: true,
};
const GLOBAL_VALUE: AbstractValue = {
  ...UNKNOWN_VALUE,
  globalObject: true,
};
const OBJECT_VALUE: AbstractValue = {
  ...UNKNOWN_VALUE,
  objectIntrinsic: true,
};
const REFLECT_VALUE: AbstractValue = {
  ...UNKNOWN_VALUE,
  reflectIntrinsic: true,
};

function stringValue(value: string): AbstractValue {
  return { ...UNKNOWN_VALUE, strings: new Set([value]) };
}

function mergeValues(...values: AbstractValue[]): AbstractValue {
  if (values.length === 0) return UNKNOWN_VALUE;
  const strings = new Set<string>();
  for (const value of values) {
    for (const text of value.strings) strings.add(text);
  }
  return {
    fetchFunction: values.some((value) => value.fetchFunction),
    globalObject: values.some((value) => value.globalObject),
    objectIntrinsic: values.some((value) => value.objectIntrinsic),
    reflectIntrinsic: values.some((value) => value.reflectIntrinsic),
    strings,
  };
}

class LexicalScope {
  readonly bindings = new Map<string, AbstractValue>();

  constructor(readonly parent?: LexicalScope) {}

  declare(name: string, value: AbstractValue = UNKNOWN_VALUE): void {
    this.bindings.set(name, value);
  }

  lookup(name: string): AbstractValue | undefined {
    if (this.bindings.has(name)) return this.bindings.get(name);
    return this.parent?.lookup(name);
  }

  assign(name: string, value: AbstractValue): boolean {
    if (this.bindings.has(name)) {
      this.bindings.set(name, value);
      return true;
    }
    return this.parent?.assign(name, value) ?? false;
  }
}

type ScopeSnapshot = Map<LexicalScope, Map<string, AbstractValue>>;

function scopeChain(scope: LexicalScope): LexicalScope[] {
  const scopes: LexicalScope[] = [];
  for (let current: LexicalScope | undefined = scope; current; current = current.parent) {
    scopes.push(current);
  }
  return scopes;
}

function snapshotScope(scope: LexicalScope): ScopeSnapshot {
  return new Map(
    scopeChain(scope).map((current) => [
      current,
      new Map(current.bindings),
    ]),
  );
}

function restoreScope(snapshot: ScopeSnapshot): void {
  for (const [scope, bindings] of snapshot) {
    scope.bindings.clear();
    for (const [name, value] of bindings) scope.bindings.set(name, value);
  }
}

function mergeScopeSnapshots(
  base: ScopeSnapshot,
  left: ScopeSnapshot,
  right: ScopeSnapshot,
): void {
  for (const [scope, bindings] of base) {
    scope.bindings.clear();
    for (const [name, baseValue] of bindings) {
      scope.bindings.set(
        name,
        mergeValues(
          left.get(scope)?.get(name) ?? baseValue,
          right.get(scope)?.get(name) ?? baseValue,
        ),
      );
    }
  }
}

function declareBindingName(name: ts.BindingName, scope: LexicalScope): void {
  if (ts.isIdentifier(name)) {
    scope.declare(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) declareBindingName(element.name, scope);
  }
}

function predeclareStatements(
  statements: readonly ts.Statement[],
  scope: LexicalScope,
): void {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        declareBindingName(declaration.name, scope);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      scope.declare(statement.name.text);
    } else if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name) scope.declare(clause.name.text);
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          scope.declare(clause.namedBindings.name.text);
        } else {
          for (const element of clause.namedBindings.elements) {
            scope.declare(element.name.text);
          }
        }
      }
    } else if (ts.isImportEqualsDeclaration(statement)) {
      scope.declare(statement.name.text);
    }
  }
}

function propertyNameValue(
  name: ts.PropertyName,
  scope: LexicalScope,
  analysis: FetchAnalysis,
): AbstractValue {
  if (ts.isComputedPropertyName(name)) {
    return evaluateExpression(name.expression, scope, analysis);
  }
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return stringValue(name.text);
  }
  return UNKNOWN_VALUE;
}

function hasFetchString(value: AbstractValue): boolean {
  return value.strings.has("fetch");
}

function evaluateIdentifier(
  identifier: ts.Identifier,
  scope: LexicalScope,
  analysis: FetchAnalysis,
): AbstractValue {
  const bound = scope.lookup(identifier.text);
  if (bound !== undefined) return bound;
  switch (identifier.text) {
    case "fetch":
      analysis.access = true;
      return FETCH_VALUE;
    case "global":
    case "globalThis":
    case "self":
    case "window":
      return GLOBAL_VALUE;
    case "Object":
      return OBJECT_VALUE;
    case "Reflect":
      return REFLECT_VALUE;
    default:
      return UNKNOWN_VALUE;
  }
}

function bindValue(
  name: ts.BindingName,
  value: AbstractValue,
  scope: LexicalScope,
  analysis: FetchAnalysis,
): void {
  if (ts.isIdentifier(name)) {
    if (!scope.assign(name.text, value)) scope.declare(name.text, value);
    return;
  }
  if (ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) {
      if (element.dotDotDotToken) {
        bindValue(element.name, UNKNOWN_VALUE, scope, analysis);
        continue;
      }
      const property = element.propertyName ?? element.name;
      const key = ts.isBindingName(property)
        ? ts.isIdentifier(property)
          ? stringValue(property.text)
          : UNKNOWN_VALUE
        : propertyNameValue(property, scope, analysis);
      let elementValue = UNKNOWN_VALUE;
      if (value.globalObject && hasFetchString(key)) {
        analysis.access = true;
        elementValue = FETCH_VALUE;
      }
      if (element.initializer) {
        elementValue = mergeValues(
          elementValue,
          evaluateExpression(element.initializer, scope, analysis),
        );
      }
      bindValue(element.name, elementValue, scope, analysis);
    }
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      let elementValue = UNKNOWN_VALUE;
      if (element.initializer) {
        elementValue = evaluateExpression(element.initializer, scope, analysis);
      }
      bindValue(element.name, elementValue, scope, analysis);
    }
  }
}

function analyzeFunctionLike(
  node: ts.FunctionLikeDeclaration,
  outerScope: LexicalScope,
  analysis: FetchAnalysis,
): void {
  const scope = new LexicalScope(outerScope);
  if (
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
    node.name
  ) {
    scope.declare(node.name.text);
  }
  for (const parameter of node.parameters) declareBindingName(parameter.name, scope);
  for (const parameter of node.parameters) {
    const value = parameter.initializer
      ? evaluateExpression(parameter.initializer, scope, analysis)
      : UNKNOWN_VALUE;
    bindValue(parameter.name, value, scope, analysis);
  }
  if (!node.body) return;
  if (ts.isBlock(node.body)) {
    analyzeStatements(node.body.statements, scope, analysis);
  } else {
    evaluateExpression(node.body, scope, analysis);
  }
}

function evaluateObjectLiteral(
  expression: ts.ObjectLiteralExpression,
  scope: LexicalScope,
  analysis: FetchAnalysis,
): void {
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) {
      evaluateExpression(property.expression, scope, analysis);
    } else if (ts.isPropertyAssignment(property)) {
      propertyNameValue(property.name, scope, analysis);
      evaluateExpression(property.initializer, scope, analysis);
    } else if (ts.isShorthandPropertyAssignment(property)) {
      evaluateIdentifier(property.name, scope, analysis);
      if (property.objectAssignmentInitializer) {
        evaluateExpression(property.objectAssignmentInitializer, scope, analysis);
      }
    } else {
      propertyNameValue(property.name, scope, analysis);
      analyzeFunctionLike(property, scope, analysis);
    }
  }
}

function markDefineProperties(
  descriptors: ts.Expression | undefined,
  scope: LexicalScope,
  analysis: FetchAnalysis,
): void {
  if (!descriptors) return;
  const expression = unwrapExpression(descriptors);
  if (!ts.isObjectLiteralExpression(expression)) {
    evaluateExpression(expression, scope, analysis);
    return;
  }
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) {
      evaluateExpression(property.expression, scope, analysis);
      continue;
    }
    if (hasFetchString(propertyNameValue(property.name, scope, analysis))) {
      analysis.reassignment = true;
    }
    if (ts.isPropertyAssignment(property)) {
      evaluateExpression(property.initializer, scope, analysis);
    } else if (ts.isShorthandPropertyAssignment(property)) {
      evaluateIdentifier(property.name, scope, analysis);
    } else {
      analyzeFunctionLike(property, scope, analysis);
    }
  }
}

function callTarget(
  expression: ts.LeftHandSideExpression,
  scope: LexicalScope,
  analysis: FetchAnalysis,
): { base: AbstractValue; names: AbstractValue } | null {
  const current = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(current)) {
    return {
      base: evaluateExpression(current.expression, scope, analysis),
      names: stringValue(current.name.text),
    };
  }
  if (ts.isElementAccessExpression(current) && current.argumentExpression) {
    return {
      base: evaluateExpression(current.expression, scope, analysis),
      names: evaluateExpression(current.argumentExpression, scope, analysis),
    };
  }
  return null;
}

function evaluateCall(
  expression: ts.CallExpression,
  scope: LexicalScope,
  analysis: FetchAnalysis,
): AbstractValue {
  const target = callTarget(expression.expression, scope, analysis);
  if (target?.base.reflectIntrinsic && target.names.strings.has("get")) {
    const object = expression.arguments[0]
      ? evaluateExpression(expression.arguments[0], scope, analysis)
      : UNKNOWN_VALUE;
    const key = expression.arguments[1]
      ? evaluateExpression(expression.arguments[1], scope, analysis)
      : UNKNOWN_VALUE;
    for (const argument of expression.arguments.slice(2)) {
      evaluateExpression(argument, scope, analysis);
    }
    if (object.globalObject && hasFetchString(key)) {
      analysis.access = true;
      return FETCH_VALUE;
    }
    return UNKNOWN_VALUE;
  }
  if (target?.base.reflectIntrinsic && target.names.strings.has("set")) {
    const object = expression.arguments[0]
      ? evaluateExpression(expression.arguments[0], scope, analysis)
      : UNKNOWN_VALUE;
    const key = expression.arguments[1]
      ? evaluateExpression(expression.arguments[1], scope, analysis)
      : UNKNOWN_VALUE;
    for (const argument of expression.arguments.slice(2)) {
      evaluateExpression(argument, scope, analysis);
    }
    if (object.globalObject && hasFetchString(key)) analysis.reassignment = true;
    return UNKNOWN_VALUE;
  }
  if (target?.base.objectIntrinsic && target.names.strings.has("defineProperty")) {
    const object = expression.arguments[0]
      ? evaluateExpression(expression.arguments[0], scope, analysis)
      : UNKNOWN_VALUE;
    const key = expression.arguments[1]
      ? evaluateExpression(expression.arguments[1], scope, analysis)
      : UNKNOWN_VALUE;
    if (expression.arguments[2]) {
      evaluateExpression(expression.arguments[2], scope, analysis);
    }
    if (object.globalObject && hasFetchString(key)) analysis.reassignment = true;
    return UNKNOWN_VALUE;
  }
  if (target?.base.objectIntrinsic && target.names.strings.has("defineProperties")) {
    const object = expression.arguments[0]
      ? evaluateExpression(expression.arguments[0], scope, analysis)
      : UNKNOWN_VALUE;
    if (object.globalObject) {
      markDefineProperties(expression.arguments[1], scope, analysis);
    } else if (expression.arguments[1]) {
      evaluateExpression(expression.arguments[1], scope, analysis);
    }
    return UNKNOWN_VALUE;
  }

  const callee = evaluateExpression(expression.expression, scope, analysis);
  for (const argument of expression.arguments) {
    evaluateExpression(argument, scope, analysis);
  }
  if (callee.fetchFunction) analysis.access = true;
  return UNKNOWN_VALUE;
}

function assignTarget(
  target: ts.Expression,
  value: AbstractValue,
  scope: LexicalScope,
  analysis: FetchAnalysis,
): void {
  const current = unwrapExpression(target);
  if (ts.isIdentifier(current)) {
    if (current.text === "fetch" && scope.lookup(current.text) === undefined) {
      analysis.reassignment = true;
    } else {
      scope.assign(current.text, value);
    }
    return;
  }
  if (ts.isPropertyAccessExpression(current)) {
    const object = evaluateExpression(current.expression, scope, analysis);
    if (object.globalObject && current.name.text === "fetch") {
      analysis.reassignment = true;
    }
    return;
  }
  if (ts.isElementAccessExpression(current)) {
    const object = evaluateExpression(current.expression, scope, analysis);
    const key = current.argumentExpression
      ? evaluateExpression(current.argumentExpression, scope, analysis)
      : UNKNOWN_VALUE;
    if (object.globalObject && hasFetchString(key)) analysis.reassignment = true;
  }
}

function concatenateStrings(
  left: AbstractValue,
  right: AbstractValue,
): AbstractValue {
  if (left.strings.size === 0 || right.strings.size === 0) return UNKNOWN_VALUE;
  const strings = new Set<string>();
  for (const prefix of left.strings) {
    for (const suffix of right.strings) {
      if (strings.size < 32) strings.add(`${prefix}${suffix}`);
    }
  }
  return { ...UNKNOWN_VALUE, strings };
}

function evaluateExpression(
  input: ts.Expression,
  scope: LexicalScope,
  analysis: FetchAnalysis,
): AbstractValue {
  const expression = unwrapExpression(input);
  if (ts.isIdentifier(expression)) {
    return evaluateIdentifier(expression, scope, analysis);
  }
  if (ts.isStringLiteralLike(expression)) return stringValue(expression.text);
  if (
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    ts.isNumericLiteral(expression)
  ) {
    return stringValue(expression.text);
  }
  if (ts.isTemplateExpression(expression)) {
    let value = stringValue(expression.head.text);
    for (const span of expression.templateSpans) {
      value = concatenateStrings(
        value,
        evaluateExpression(span.expression, scope, analysis),
      );
      value = concatenateStrings(value, stringValue(span.literal.text));
    }
    return value;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const object = evaluateExpression(expression.expression, scope, analysis);
    if (object.globalObject && expression.name.text === "fetch") {
      analysis.access = true;
      return FETCH_VALUE;
    }
    if (object.fetchFunction && expression.name.text === "bind") {
      return FETCH_VALUE;
    }
    return UNKNOWN_VALUE;
  }
  if (ts.isElementAccessExpression(expression)) {
    const object = evaluateExpression(expression.expression, scope, analysis);
    const key = expression.argumentExpression
      ? evaluateExpression(expression.argumentExpression, scope, analysis)
      : UNKNOWN_VALUE;
    if (object.globalObject && hasFetchString(key)) {
      analysis.access = true;
      return FETCH_VALUE;
    }
    if (object.fetchFunction && key.strings.has("bind")) return FETCH_VALUE;
    return UNKNOWN_VALUE;
  }
  if (ts.isCallExpression(expression)) {
    return evaluateCall(expression, scope, analysis);
  }
  if (ts.isNewExpression(expression)) {
    evaluateExpression(expression.expression, scope, analysis);
    for (const argument of expression.arguments ?? []) {
      evaluateExpression(argument, scope, analysis);
    }
    return UNKNOWN_VALUE;
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (
      operator >= ts.SyntaxKind.FirstAssignment &&
      operator <= ts.SyntaxKind.LastAssignment
    ) {
      const value = evaluateExpression(expression.right, scope, analysis);
      assignTarget(expression.left, value, scope, analysis);
      return value;
    }
    const left = evaluateExpression(expression.left, scope, analysis);
    const right = evaluateExpression(expression.right, scope, analysis);
    if (operator === ts.SyntaxKind.PlusToken) return concatenateStrings(left, right);
    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.CommaToken
    ) {
      return mergeValues(left, right);
    }
    return UNKNOWN_VALUE;
  }
  if (ts.isConditionalExpression(expression)) {
    evaluateExpression(expression.condition, scope, analysis);
    return mergeValues(
      evaluateExpression(expression.whenTrue, scope, analysis),
      evaluateExpression(expression.whenFalse, scope, analysis),
    );
  }
  if (
    ts.isPrefixUnaryExpression(expression) ||
    ts.isPostfixUnaryExpression(expression)
  ) {
    evaluateExpression(expression.operand, scope, analysis);
    if (ts.isIdentifier(expression.operand)) {
      scope.assign(expression.operand.text, UNKNOWN_VALUE);
    }
    return UNKNOWN_VALUE;
  }
  if (
    ts.isAwaitExpression(expression) ||
    ts.isVoidExpression(expression) ||
    ts.isDeleteExpression(expression) ||
    ts.isTypeOfExpression(expression)
  ) {
    return evaluateExpression(expression.expression, scope, analysis);
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    analyzeFunctionLike(expression, scope, analysis);
    return UNKNOWN_VALUE;
  }
  if (ts.isObjectLiteralExpression(expression)) {
    evaluateObjectLiteral(expression, scope, analysis);
    return UNKNOWN_VALUE;
  }
  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) {
        evaluateExpression(element.expression, scope, analysis);
      } else if (!ts.isOmittedExpression(element)) {
        evaluateExpression(element, scope, analysis);
      }
    }
    return UNKNOWN_VALUE;
  }
  if (ts.isJsxElement(expression) || ts.isJsxFragment(expression)) {
    ts.forEachChild(expression, (child) => {
      if (ts.isJsxExpression(child) && child.expression) {
        evaluateExpression(child.expression, scope, analysis);
      }
    });
    return UNKNOWN_VALUE;
  }
  if (ts.isJsxSelfClosingElement(expression)) {
    for (const attribute of expression.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) {
        evaluateExpression(attribute.expression, scope, analysis);
      } else if (attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
        if (attribute.initializer.expression) {
          evaluateExpression(attribute.initializer.expression, scope, analysis);
        }
      }
    }
    return UNKNOWN_VALUE;
  }
  ts.forEachChild(expression, (child) => {
    if (ts.isExpression(child)) evaluateExpression(child, scope, analysis);
  });
  return UNKNOWN_VALUE;
}

function analyzeBranch(
  scope: LexicalScope,
  analysis: FetchAnalysis,
  whenTrue: ts.Statement,
  whenFalse?: ts.Statement,
): void {
  const base = snapshotScope(scope);
  analyzeStatement(whenTrue, scope, analysis);
  const trueSnapshot = snapshotScope(scope);
  restoreScope(base);
  if (whenFalse) analyzeStatement(whenFalse, scope, analysis);
  const falseSnapshot = snapshotScope(scope);
  mergeScopeSnapshots(base, trueSnapshot, falseSnapshot);
}

function analyzeClassLike(
  node: ts.ClassLikeDeclaration,
  outerScope: LexicalScope,
  analysis: FetchAnalysis,
): void {
  const scope = new LexicalScope(outerScope);
  if (node.name) scope.declare(node.name.text);
  for (const member of node.members) {
    if (member.name) propertyNameValue(member.name, scope, analysis);
    if (ts.isPropertyDeclaration(member) && member.initializer) {
      evaluateExpression(member.initializer, scope, analysis);
    } else if (
      ts.isMethodDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member) ||
      ts.isConstructorDeclaration(member)
    ) {
      analyzeFunctionLike(member, scope, analysis);
    } else if (ts.isClassStaticBlockDeclaration(member)) {
      analyzeStatements(member.body.statements, scope, analysis);
    }
  }
}

function analyzeVariableDeclarationList(
  list: ts.VariableDeclarationList,
  scope: LexicalScope,
  analysis: FetchAnalysis,
): void {
  for (const declaration of list.declarations) {
    const value = declaration.initializer
      ? evaluateExpression(declaration.initializer, scope, analysis)
      : UNKNOWN_VALUE;
    bindValue(declaration.name, value, scope, analysis);
  }
}

function analyzeStatement(
  statement: ts.Statement,
  scope: LexicalScope,
  analysis: FetchAnalysis,
): void {
  if (ts.isExpressionStatement(statement)) {
    evaluateExpression(statement.expression, scope, analysis);
  } else if (ts.isVariableStatement(statement)) {
    analyzeVariableDeclarationList(statement.declarationList, scope, analysis);
  } else if (ts.isFunctionDeclaration(statement)) {
    analyzeFunctionLike(statement, scope, analysis);
  } else if (ts.isClassDeclaration(statement)) {
    analyzeClassLike(statement, scope, analysis);
  } else if (ts.isBlock(statement)) {
    analyzeStatements(statement.statements, new LexicalScope(scope), analysis);
  } else if (ts.isIfStatement(statement)) {
    evaluateExpression(statement.expression, scope, analysis);
    analyzeBranch(scope, analysis, statement.thenStatement, statement.elseStatement);
  } else if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
    if (statement.expression) evaluateExpression(statement.expression, scope, analysis);
  } else if (ts.isForStatement(statement)) {
    const loopScope = new LexicalScope(scope);
    if (statement.initializer && ts.isVariableDeclarationList(statement.initializer)) {
      for (const declaration of statement.initializer.declarations) {
        declareBindingName(declaration.name, loopScope);
      }
      analyzeVariableDeclarationList(statement.initializer, loopScope, analysis);
    } else if (statement.initializer) {
      evaluateExpression(statement.initializer, loopScope, analysis);
    }
    if (statement.condition) evaluateExpression(statement.condition, loopScope, analysis);
    analyzeBranch(loopScope, analysis, statement.statement);
    if (statement.incrementor) evaluateExpression(statement.incrementor, loopScope, analysis);
  } else if (ts.isForInStatement(statement) || ts.isForOfStatement(statement)) {
    const loopScope = new LexicalScope(scope);
    evaluateExpression(statement.expression, loopScope, analysis);
    if (ts.isVariableDeclarationList(statement.initializer)) {
      for (const declaration of statement.initializer.declarations) {
        declareBindingName(declaration.name, loopScope);
      }
      analyzeVariableDeclarationList(statement.initializer, loopScope, analysis);
    } else {
      assignTarget(statement.initializer, UNKNOWN_VALUE, loopScope, analysis);
    }
    analyzeBranch(loopScope, analysis, statement.statement);
  } else if (ts.isWhileStatement(statement)) {
    evaluateExpression(statement.expression, scope, analysis);
    analyzeBranch(scope, analysis, statement.statement);
  } else if (ts.isDoStatement(statement)) {
    analyzeStatement(statement.statement, scope, analysis);
    evaluateExpression(statement.expression, scope, analysis);
  } else if (ts.isTryStatement(statement)) {
    analyzeStatement(statement.tryBlock, scope, analysis);
    if (statement.catchClause) {
      const catchScope = new LexicalScope(scope);
      if (statement.catchClause.variableDeclaration) {
        declareBindingName(statement.catchClause.variableDeclaration.name, catchScope);
        bindValue(
          statement.catchClause.variableDeclaration.name,
          UNKNOWN_VALUE,
          catchScope,
          analysis,
        );
      }
      analyzeStatements(statement.catchClause.block.statements, catchScope, analysis);
    }
    if (statement.finallyBlock) analyzeStatement(statement.finallyBlock, scope, analysis);
  } else if (ts.isSwitchStatement(statement)) {
    evaluateExpression(statement.expression, scope, analysis);
    const switchScope = new LexicalScope(scope);
    for (const clause of statement.caseBlock.clauses) {
      if (ts.isCaseClause(clause)) evaluateExpression(clause.expression, switchScope, analysis);
      analyzeStatements(clause.statements, switchScope, analysis);
    }
  } else if (ts.isLabeledStatement(statement)) {
    analyzeStatement(statement.statement, scope, analysis);
  } else if (ts.isWithStatement(statement)) {
    evaluateExpression(statement.expression, scope, analysis);
    analyzeStatement(statement.statement, scope, analysis);
  } else if (ts.isExportAssignment(statement)) {
    evaluateExpression(statement.expression, scope, analysis);
  }
}

function analyzeStatements(
  statements: readonly ts.Statement[],
  scope: LexicalScope,
  analysis: FetchAnalysis,
): void {
  predeclareStatements(statements, scope);
  for (const statement of statements) analyzeStatement(statement, scope, analysis);
}

function analyzeFetch(sourceFile: ts.SourceFile): FetchAnalysis {
  const analysis: FetchAnalysis = { access: false, reassignment: false };
  analyzeStatements(sourceFile.statements, new LexicalScope(), analysis);
  return analysis;
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
    const fetch = analyzeFetch(value.sourceFile);
    if (fetch.reassignment) {
      add(path, "fetch-reassignment");
    }
    if (
      clientGraph.has(path) &&
      !CLIENT_FETCH_ALLOWLIST.has(path) &&
      fetch.access
    ) {
      add(path, "client-fetch");
    }
  }

  return violations.sort((left, right) =>
    `${left.path}:${left.rule}`.localeCompare(`${right.path}:${right.rule}`),
  );
}
