import type { SgNode } from "@ast-grep/napi";

function isFunctionKind(node: SgNode): boolean {
  return [
    "function_declaration",
    "function_expression",
    "arrow_function",
    "method_definition",
    "generator_function_declaration",
    "generator_function",
  ].includes(node.kind());
}

function isSameNode(left: SgNode | null, right: SgNode | null): boolean {
  if (left === null || right === null) {
    return false;
  }
  const leftRange = left.range();
  const rightRange = right.range();
  return (
    left.kind() === right.kind() &&
    leftRange.start.index === rightRange.start.index &&
    leftRange.end.index === rightRange.end.index
  );
}

function findAncestor(node: SgNode, kind: string): SgNode | null {
  let ancestor = node.parent();
  while (ancestor !== null && ancestor.kind() !== kind) {
    ancestor = ancestor.parent();
  }
  return ancestor;
}

function resolveName(node: SgNode): string | null {
  const kind = node.kind();
  if (kind === "function_declaration" || kind === "generator_function_declaration") {
    return node.field("name")?.text() ?? null;
  }
  if (kind === "method_definition") {
    const method = node.field("name")?.text() ?? null;
    const className = findAncestor(node, "class_declaration")?.field("name")?.text();
    return className && method ? `${className}.${method}` : method;
  }
  const parent = node.parent();
  if (parent !== null && parent.kind() === "variable_declarator" && isSameNode(parent.field("value"), node)) {
    return parent.field("name")?.text() ?? null;
  }
  return null;
}

function bareName(node: SgNode): string | null {
  const name = resolveName(node);
  return name === null || name.includes(".") ? null : name;
}

function countParameters(node: SgNode): number {
  const parameters = node.field("parameters");
  if (parameters === null) {
    return node.field("parameter") === null ? 0 : 1;
  }
  return parameters
    .children()
    .filter((child) => child.isNamed() && child.kind() !== "comment")
    .filter((child) => !/^this(?![\w$])/.test(child.text())).length;
}

function containsThis(node: SgNode): boolean {
  for (const child of node.children()) {
    if (isFunctionKind(child) && child.kind() !== "arrow_function") {
      continue;
    }
    if (child.kind() === "this" || containsThis(child)) {
      return true;
    }
  }
  return false;
}

export function listFunctions(root: SgNode): Array<{
  node: SgNode;
  name: string | null;
  line: number;
  endLine: number;
  parameterCount: number;
  usesThis: boolean;
  bodyText: string;
}> {
  const kinds = [
    "function_declaration",
    "function_expression",
    "arrow_function",
    "method_definition",
    "generator_function_declaration",
  ];
  const nodes = root.findAll({ rule: { any: kinds.map((kind) => ({ kind })) } });
  nodes.sort((left, right) => left.range().start.index - right.range().start.index);
  return nodes.map((node) => {
    const body = node.field("body");
    return {
      node,
      name: resolveName(node),
      line: node.range().start.line + 1,
      endLine: node.range().end.line + 1,
      parameterCount: countParameters(node),
      usesThis: body !== null && (body.kind() === "this" || containsThis(body)),
      bodyText: body?.text() ?? "",
    };
  });
}

function isElseIf(node: SgNode): boolean {
  return node.kind() === "if_statement" && node.parent()?.kind() === "else_clause";
}

function blockDepth(node: SgNode, level: number): number {
  const blockKinds = [
    "if_statement",
    "for_statement",
    "for_in_statement",
    "while_statement",
    "do_statement",
    "switch_statement",
    "try_statement",
  ];
  let deepest = level;
  for (const child of node.children()) {
    if (isFunctionKind(child)) {
      continue;
    }
    const opensBlock = blockKinds.includes(child.kind()) && !isElseIf(child);
    deepest = Math.max(deepest, blockDepth(child, opensBlock ? level + 1 : level));
  }
  return deepest;
}

export function measureBlockNesting(functionNode: SgNode): number {
  return blockDepth(functionNode, 0);
}

function isArgumentFunction(node: SgNode): boolean {
  return isFunctionKind(node) && node.parent()?.kind() === "arguments";
}

function callbackDepth(node: SgNode, level: number): number {
  let deepest = level;
  for (const child of node.children()) {
    deepest = Math.max(deepest, callbackDepth(child, isArgumentFunction(child) ? level + 1 : level));
  }
  return deepest;
}

export function measureCallbackNesting(functionNode: SgNode): number {
  return callbackDepth(functionNode, 0);
}

function isThenCall(node: SgNode | null): boolean {
  if (node === null || node.kind() !== "call_expression") {
    return false;
  }
  const callee = node.field("function");
  return callee?.kind() === "member_expression" && callee.field("property")?.text() === "then";
}

function isInsideThen(node: SgNode): boolean {
  let ancestor = node.parent();
  while (ancestor !== null) {
    if (isArgumentFunction(ancestor) && isThenCall(ancestor.parent()?.parent() ?? null)) {
      return true;
    }
    ancestor = ancestor.parent();
  }
  return false;
}

export function findThenInThen(root: SgNode): number[] {
  return root
    .findAll({ rule: { kind: "call_expression" } })
    .filter((call) => isThenCall(call) && isInsideThen(call))
    .map((call) => call.range().start.line + 1);
}

function callDepth(call: SgNode): number {
  const argumentList = call.field("arguments");
  let deepest = 0;
  for (const child of argumentList?.children() ?? []) {
    if (child.kind() === "call_expression") {
      deepest = Math.max(deepest, callDepth(child));
    }
  }
  return deepest + 1;
}

export function measureCallNesting(root: SgNode): Array<{ line: number; depth: number }> {
  return root
    .findAll({ rule: { kind: "call_expression" } })
    .filter((call) => call.parent()?.kind() !== "arguments")
    .map((call) => ({ line: call.range().start.line + 1, depth: callDepth(call) }));
}

function startsLogicalSequence(node: SgNode): boolean {
  const operator = node.field("operator")?.text();
  if (operator !== "&&" && operator !== "||" && operator !== "??") {
    return false;
  }
  const parent = node.parent();
  return !(parent?.kind() === "binary_expression" && parent.field("operator")?.text() === operator);
}

function isLabeledJump(node: SgNode): boolean {
  const kind = node.kind();
  return (
    (kind === "break_statement" || kind === "continue_statement") &&
    node.children().some((child) => child.kind() === "statement_identifier")
  );
}

function isRecursionCall(node: SgNode, ownName: string | null): boolean {
  if (ownName === null || node.kind() !== "call_expression") {
    return false;
  }
  const callee = node.field("function");
  return callee?.kind() === "identifier" && callee.text() === ownName;
}

function flatIncrement(node: SgNode, ownName: string | null): number {
  const kind = node.kind();
  if (kind === "else_clause") {
    return node.children().some((child) => child.kind() === "if_statement") ? 0 : 1;
  }
  if (kind === "binary_expression") {
    return startsLogicalSequence(node) ? 1 : 0;
  }
  return isLabeledJump(node) || isRecursionCall(node, ownName) ? 1 : 0;
}

function cognitiveScore(node: SgNode, nesting: number, ownName: string | null): number {
  const nestingKinds = [
    "if_statement",
    "ternary_expression",
    "switch_statement",
    "for_statement",
    "for_in_statement",
    "while_statement",
    "do_statement",
    "catch_clause",
  ];
  let score = 0;
  for (const child of node.children()) {
    if (isFunctionKind(child)) {
      score += cognitiveScore(child, nesting + 1, ownName);
    } else if (isElseIf(child)) {
      score += 1 + cognitiveScore(child, nesting, ownName);
    } else if (nestingKinds.includes(child.kind())) {
      score += 1 + nesting + cognitiveScore(child, nesting + 1, ownName);
    } else {
      score += flatIncrement(child, ownName) + cognitiveScore(child, nesting, ownName);
    }
  }
  return score;
}

export function measureCognitiveComplexity(functionNode: SgNode): number {
  return cognitiveScore(functionNode, 0, bareName(functionNode));
}

export function countBodyLines(functionNode: SgNode): number {
  const body = functionNode.field("body");
  if (body === null) {
    return 0;
  }
  const text = body.kind() === "statement_block" ? body.text().slice(1, -1) : body.text();
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

export function countTokens(functionNode: SgNode): number {
  if (functionNode.kind() === "comment") {
    return 0;
  }
  const children = functionNode.children();
  if (children.length === 0) {
    return 1;
  }
  return children.reduce((total, child) => total + countTokens(child), 0);
}

function collectDeclared(node: SgNode, names: Set<string>): void {
  for (const child of node.children()) {
    if (isFunctionKind(child)) {
      continue;
    }
    const kind = child.kind();
    if (kind === "identifier" || kind === "shorthand_property_identifier_pattern") {
      const parentKind = child.parent()?.kind() ?? "";
      if (["variable_declarator", "required_parameter", "optional_parameter", "rest_pattern"].includes(parentKind)) {
        names.add(child.text());
      }
      if (kind === "shorthand_property_identifier_pattern") {
        names.add(child.text());
      }
    }
    collectDeclared(child, names);
  }
}

function capturesOuter(nested: SgNode, declared: Set<string>): boolean {
  return nested.findAll({ rule: { kind: "identifier" } }).some((identifier) => declared.has(identifier.text()));
}

export function countDesugared(functionNode: SgNode): number {
  const sugarKinds = [
    "spread_element",
    "rest_pattern",
    "object_pattern",
    "array_pattern",
    "optional_chain",
    "yield_expression",
    "await_expression",
    "try_statement",
    "template_substitution",
  ];
  const descendants = functionNode.findAll({ rule: { any: sugarKinds.map((kind) => ({ kind })) } });
  const nullish = functionNode
    .findAll({ rule: { kind: "binary_expression" } })
    .filter((node) => node.field("operator")?.text() === "??");
  const asyncKeyword = functionNode.children().some((child) => child.kind() === "async") ? 1 : 0;
  const declared = new Set<string>();
  collectDeclared(functionNode, declared);
  const closures = functionNode
    .findAll({ rule: { any: ["function_expression", "arrow_function", "function_declaration"].map((kind) => ({ kind })) } })
    .filter((nested) => !isSameNode(nested, functionNode) && capturesOuter(nested, declared));
  return descendants.length + nullish.length + asyncKeyword + closures.length;
}
