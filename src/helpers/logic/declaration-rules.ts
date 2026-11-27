import type { SgNode } from "@ast-grep/napi";
import type { ConfigProject } from "../../interfaces/config.ts";
import type { FindingItem } from "../../interfaces/finding.ts";
import type { RoleFile } from "../../interfaces/role.ts";
import { CHECK_LIMITS, CHECK_RULE_SEVERITY } from "../../consts/check.ts";
import { checkEntityPrefix, countNameWords, findAbbreviation } from "./naming.ts";
import {
  findThenInThen,
  listFunctions,
  measureCallbackNesting,
  measureCallNesting,
} from "./function-metrics.ts";

function lineOf(node: SgNode): number {
  return node.range().start.line + 1;
}

function namedChildren(node: SgNode): SgNode[] {
  return node.children().filter((child) => child.isNamed() && child.kind() !== "comment");
}

function isFunctionValue(node: SgNode | null): boolean {
  return node !== null && ["arrow_function", "function_expression", "generator_function"].includes(node.kind());
}

function isDataPair(node: SgNode): boolean {
  const value = node.kind() === "pair" ? node.field("value") : null;
  return value !== null && isDataInitializer(value);
}

function isWrappedData(node: SgNode): boolean {
  const children = node.children();
  if (node.kind() === "as_expression" && children[children.length - 1]?.text() !== "const") {
    return false;
  }
  const inner = namedChildren(node)[0];
  return inner !== undefined && isDataInitializer(inner);
}

function isFrozenData(node: SgNode): boolean {
  if (node.field("function")?.text() !== "Object.freeze") {
    return false;
  }
  const argumentList = node.field("arguments");
  const passed = argumentList === null ? [] : namedChildren(argumentList);
  return passed.length === 1 && isDataInitializer(passed[0]);
}

export function isDataInitializer(valueNode: SgNode): boolean {
  const kind = valueNode.kind();
  if (["string", "number", "true", "false", "null", "regex"].includes(kind)) {
    return true;
  }
  if (kind === "template_string") {
    return valueNode.find({ rule: { kind: "template_substitution" } }) === null;
  }
  if (kind === "array") {
    return namedChildren(valueNode).every((child) => isDataInitializer(child));
  }
  if (kind === "object") {
    return namedChildren(valueNode).every((child) => isDataPair(child));
  }
  if (kind === "as_expression" || kind === "satisfies_expression") {
    return isWrappedData(valueNode);
  }
  if (kind === "call_expression") {
    return isFrozenData(valueNode);
  }
  if (kind === "unary_expression") {
    return valueNode.field("operator")?.text() === "-" && valueNode.field("argument")?.kind() === "number";
  }
  return false;
}

function classifyVariable(
  keyword: string,
  value: SgNode | null,
): "constant" | "data-variable" | "function" | "object" | null {
  if (value === null) {
    return null;
  }
  if (isFunctionValue(value)) {
    return "function";
  }
  if (!isDataInitializer(value)) {
    return "object";
  }
  return keyword === "const" ? "constant" : "data-variable";
}

function classifyStatement(kind: string): "interface" | "type" | "enum" | "class" | "function" | null {
  const kinds: Record<string, "interface" | "type" | "enum" | "class" | "function"> = {
    interface_declaration: "interface",
    type_alias_declaration: "type",
    enum_declaration: "enum",
    class_declaration: "class",
    abstract_class_declaration: "class",
    function_declaration: "function",
    generator_function_declaration: "function",
  };
  return kinds[kind] ?? null;
}

function collectVariables(statement: SgNode): ReturnType<typeof collectDeclarations> {
  const keyword = statement.children()[0]?.text() ?? "var";
  const collected: ReturnType<typeof collectDeclarations> = [];
  for (const declarator of statement.children().filter((child) => child.kind() === "variable_declarator")) {
    const kind = classifyVariable(keyword, declarator.field("value"));
    const name = declarator.field("name")?.text();
    if (kind !== null && name !== undefined) {
      collected.push({ kind, name, line: lineOf(declarator), node: declarator });
    }
  }
  return collected;
}

function unwrapExport(node: SgNode): SgNode {
  if (node.kind() !== "export_statement") {
    return node;
  }
  return node.field("declaration") ?? node;
}

export function collectDeclarations(root: SgNode): Array<{
  kind: "constant" | "data-variable" | "interface" | "type" | "enum" | "class" | "function" | "object";
  name: string;
  line: number;
  node: SgNode;
}> {
  const collected: ReturnType<typeof collectDeclarations> = [];
  for (const statement of root.children().map(unwrapExport)) {
    const statementKind = statement.kind();
    if (statementKind === "lexical_declaration" || statementKind === "variable_declaration") {
      collected.push(...collectVariables(statement));
      continue;
    }
    const kind = classifyStatement(statementKind);
    const name = statement.field("name")?.text();
    if (kind !== null && name !== undefined) {
      collected.push({ kind, name, line: lineOf(statement), node: statement });
    }
  }
  return collected;
}

function makeFinding(ruleId: string, path: string, line: number, message: string): FindingItem {
  return { severity: CHECK_RULE_SEVERITY[ruleId] ?? "error", ruleId, file: path, line, message };
}

function ruleLimit(config: ConfigProject, ruleId: string, fallback: number): number {
  const setting = config.rules[ruleId];
  return typeof setting === "object" && typeof setting.max === "number" ? setting.max : fallback;
}

function countContentLines(text: string): number {
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

function hasNetworkCall(text: string): boolean {
  return /\bfetch\(|\bhttps?\.request\b/.test(text);
}

function importsInfrastructure(root: SgNode, packages: string[]): boolean {
  return root
    .children()
    .filter((child) => child.kind() === "import_statement")
    .map((statement) => statement.field("source")?.text().slice(1, -1) ?? "")
    .some((source) => packages.some((name) => source === name || source.startsWith(`${name}/`)));
}

function checkLayoutRules(
  input: { path: string; text: string; root: SgNode; role: RoleFile; config: ConfigProject },
  declarations: ReturnType<typeof collectDeclarations>,
): FindingItem[] {
  const { path, text, root, role, config } = input;
  const findings: FindingItem[] = [];
  const forbiddenKinds = ["constant", "data-variable", "interface", "type", "enum"];
  const ownDeclarations = declarations.filter((declaration) => forbiddenKinds.includes(declaration.kind));
  if (["module", "helper", "util"].includes(role.role)) {
    for (const declaration of ownDeclarations) {
      const isShape = declaration.kind === "interface" || declaration.kind === "type";
      const folder = isShape ? config.roles.interfaces[0] : config.roles.consts[0];
      const message = `${declaration.kind} ${declaration.name} belongs in ${folder}`;
      findings.push(makeFinding("layout-forbidden-declaration", path, declaration.line, message));
    }
  }
  if (role.role === "helper" || role.role === "util") {
    for (const declaration of declarations.filter((entry) => entry.kind === "class" || entry.kind === "object")) {
      const message = `${declaration.kind} ${declaration.name} is not a function`;
      findings.push(makeFinding("helpers-only-functions", path, declaration.line, message));
    }
  }
  const sizeLimit = ruleLimit(config, "single-file-module-size", config.singleFileMaxLines);
  const lineCount = countContentLines(text);
  if (role.role === "single-file-module" && ownDeclarations.length > 0 && lineCount > sizeLimit) {
    const message = `single-file module has ${lineCount} lines (max ${sizeLimit}); turn it into a folder`;
    findings.push(makeFinding("single-file-module-size", path, 1, message));
  }
  if (role.role === "helper") {
    findings.push(...checkMixedKind(path, root, declarations, config));
  }
  if (role.role === "consts" || role.role === "interfaces") {
    findings.push(...checkEntityPrefixes(path, role, declarations, config));
  }
  return findings;
}

function checkMixedKind(
  path: string,
  root: SgNode,
  declarations: ReturnType<typeof collectDeclarations>,
  config: ConfigProject,
): FindingItem[] {
  const functionTexts = declarations.filter((entry) => entry.kind === "function").map((entry) => entry.node.text());
  const networkCount = functionTexts.filter((functionText) => hasNetworkCall(functionText)).length;
  const withStorage = importsInfrastructure(root, config.infrastructurePackages) && hasNetworkCall(root.text());
  const mixesFunctions = networkCount > 0 && networkCount < functionTexts.length;
  if (!withStorage && !mixesFunctions) {
    return [];
  }
  const message = withStorage
    ? "helper mixes an infrastructure package with network calls"
    : "helper mixes functions with and without network calls";
  return [makeFinding("helpers-mixed-kind", path, 1, message)];
}

function checkEntityPrefixes(
  path: string,
  role: RoleFile,
  declarations: ReturnType<typeof collectDeclarations>,
  config: ConfigProject,
): FindingItem[] {
  const findings: FindingItem[] = [];
  const kindMap: Record<string, "constant" | "type"> = {
    constant: "constant",
    "data-variable": "constant",
    interface: "type",
    type: "type",
  };
  for (const declaration of declarations) {
    const kind = kindMap[declaration.kind];
    if (kind === undefined) {
      continue;
    }
    const message = checkEntityPrefix(declaration.name, {
      kind,
      entity: role.global ? null : role.entity,
      constantCase: config.constantCase,
      interfacePrefix: config.interfacePrefix,
      entityPrefix: config.entityPrefix,
    });
    if (message !== null) {
      findings.push(makeFinding("name-entity-prefix", path, declaration.line, message));
    }
  }
  return findings;
}

function checkGlobalFunctions(
  path: string,
  root: SgNode,
  role: RoleFile,
  declarations: ReturnType<typeof collectDeclarations>,
): FindingItem[] {
  const findings: FindingItem[] = [];
  const isStrictRole = ["other", "interfaces", "consts"].includes(role.role);
  for (const declaration of declarations.filter((entry) => entry.kind === "function")) {
    const isForbidden = isStrictRole || (role.role === "entrypoint" && declaration.name !== "main");
    if (isForbidden) {
      const message = `top-level function ${declaration.name} outside a module, helper or util`;
      findings.push(makeFinding("global-function", path, declaration.line, message));
    }
  }
  for (const assignment of root.findAll({ rule: { kind: "assignment_expression" } })) {
    const target = assignment.field("left");
    const owner = target?.kind() === "member_expression" ? target.field("object")?.text() : undefined;
    if (owner !== undefined && ["globalThis", "window", "global"].includes(owner) && isFunctionValue(assignment.field("right"))) {
      findings.push(makeFinding("global-function", path, lineOf(assignment), `function assigned to ${target?.text()}`));
    }
  }
  const ambientBlocks = root.children().filter((child) => child.kind() === "ambient_declaration");
  for (const block of ambientBlocks.filter((child) => child.text().startsWith("declare global"))) {
    const member = block.find({ rule: { any: [{ kind: "function_signature" }, { kind: "function_declaration" }] } });
    if (member !== null) {
      const name = member.field("name")?.text() ?? "function";
      findings.push(makeFinding("global-function", path, lineOf(member), `declare global adds function ${name}`));
    }
  }
  return findings;
}

function parameterNodes(functionNode: SgNode): SgNode[] {
  const single = functionNode.field("parameter");
  const parameterList = functionNode.field("parameters");
  const entries = parameterList === null ? (single === null ? [] : [single]) : namedChildren(parameterList);
  return entries
    .map((entry) => {
      if (entry.kind() === "required_parameter" || entry.kind() === "optional_parameter") {
        return entry.field("pattern");
      }
      return entry.kind() === "assignment_pattern" ? entry.field("left") : entry;
    })
    .filter((entry): entry is SgNode => entry !== null && entry.kind() === "identifier");
}

function isKnownKind(root: SgNode, kind: string): boolean {
  try {
    root.matches({ rule: { kind } });
    return true;
  } catch {
    return false;
  }
}

function collectNameNodes(root: SgNode): SgNode[] {
  const namedKinds = [
    "variable_declarator",
    "function_declaration",
    "generator_function_declaration",
    "function_expression",
    "class_declaration",
    "abstract_class_declaration",
    "class",
    "interface_declaration",
    "type_alias_declaration",
    "enum_declaration",
    "method_definition",
  ];
  const declared = root
    .findAll({ rule: { any: namedKinds.filter((kind) => isKnownKind(root, kind)).map((kind) => ({ kind })) } })
    .map((node) => node.field("name"))
    .filter((name): name is SgNode => name !== null && name.kind() !== "array_pattern" && name.kind() !== "object_pattern");
  const parameters = listFunctions(root).flatMap((entry) => parameterNodes(entry.node));
  const seen = new Set<number>();
  return [...declared, ...parameters]
    .filter((node) => {
      const start = node.range().start.index;
      const isNew = !seen.has(start);
      seen.add(start);
      return isNew;
    })
    .sort((left, right) => left.range().start.index - right.range().start.index);
}

function checkNamingRules(path: string, root: SgNode, role: RoleFile, config: ConfigProject): FindingItem[] {
  const findings: FindingItem[] = [];
  const wordLimit = ruleLimit(config, "name-word-count", CHECK_LIMITS.maxWords);
  const entityPrefix = role.global ? null : role.entity;
  for (const nameNode of collectNameNodes(root)) {
    const name = nameNode.text();
    const abbreviation = findAbbreviation(name, config.abbreviationAllowlist);
    if (abbreviation !== null) {
      findings.push(makeFinding("name-abbreviation", path, lineOf(nameNode), `${name} contains abbreviation ${abbreviation}`));
    }
    const wordCount = countNameWords(name, entityPrefix);
    if (wordCount > wordLimit) {
      findings.push(makeFinding("name-word-count", path, lineOf(nameNode), `${name} has ${wordCount} words (max ${wordLimit})`));
    }
  }
  return findings;
}

function isFunctionNode(node: SgNode): boolean {
  return isFunctionValue(node) || ["function_declaration", "generator_function_declaration", "method_definition"].includes(node.kind());
}

function opensBlock(node: SgNode): boolean {
  const blockKinds = [
    "if_statement",
    "for_statement",
    "for_in_statement",
    "while_statement",
    "do_statement",
    "switch_statement",
    "try_statement",
  ];
  const isElseIf = node.kind() === "if_statement" && node.parent()?.kind() === "else_clause";
  return blockKinds.includes(node.kind()) && !isElseIf;
}

function findDeepBlock(node: SgNode, level: number, limit: number): SgNode | null {
  for (const child of node.children()) {
    if (isFunctionNode(child)) {
      continue;
    }
    const depth = opensBlock(child) ? level + 1 : level;
    if (depth > limit) {
      return child;
    }
    const found = findDeepBlock(child, depth, limit);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function checkFunctionRules(path: string, root: SgNode, config: ConfigProject): FindingItem[] {
  const findings: FindingItem[] = [];
  const parameterLimit = ruleLimit(config, "max-params", CHECK_LIMITS.maxParameters);
  const nestingLimit = ruleLimit(config, "max-nesting", CHECK_LIMITS.maxNesting);
  for (const entry of listFunctions(root)) {
    const name = entry.name ?? "anonymous";
    if (entry.parameterCount > parameterLimit) {
      const message = `function ${name} has ${entry.parameterCount} parameters (max ${parameterLimit})`;
      findings.push(makeFinding("max-params", path, entry.line, message));
    }
    const deepBlock = findDeepBlock(entry.node, 0, nestingLimit);
    const callbackDepth = measureCallbackNesting(entry.node);
    if (deepBlock !== null) {
      findings.push(makeFinding("max-nesting", path, lineOf(deepBlock), `function ${name} nests blocks deeper than ${nestingLimit}`));
    } else if (callbackDepth > CHECK_LIMITS.maxCallbackNesting) {
      const message = `function ${name} nests callbacks ${callbackDepth} levels deep (max ${CHECK_LIMITS.maxCallbackNesting})`;
      findings.push(makeFinding("max-nesting", path, entry.line, message));
    }
  }
  for (const line of findThenInThen(root)) {
    findings.push(makeFinding("max-nesting", path, line, "then called inside another then callback"));
  }
  const callLimit = ruleLimit(config, "max-call-nesting", CHECK_LIMITS.maxCallNesting);
  for (const call of measureCallNesting(root).filter((entry) => entry.depth > callLimit)) {
    findings.push(makeFinding("max-call-nesting", path, call.line, `calls nested ${call.depth} levels deep (max ${callLimit})`));
  }
  return findings;
}

export function checkDeclarations(input: {
  path: string;
  text: string;
  root: SgNode;
  role: RoleFile;
  config: ConfigProject;
}): FindingItem[] {
  const { path, root, role, config } = input;
  const declarations = collectDeclarations(root);
  const layoutFindings = config.layout === "off" ? [] : checkLayoutRules(input, declarations);
  return [
    ...layoutFindings,
    ...checkGlobalFunctions(path, root, role, declarations),
    ...checkNamingRules(path, root, role, config),
    ...checkFunctionRules(path, root, config),
  ];
}
