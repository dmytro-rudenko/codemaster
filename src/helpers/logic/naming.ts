import { ABBREVIATIONS_WORDS } from "../../consts/abbreviations.ts";
import { splitWords, toEntityCase } from "../../utils/words.ts";

export function findAbbreviation(name: string, allowlist: string[]): string | null {
  if (name.length === 1 && name !== "_") {
    return name;
  }
  const found = splitWords(name).find(
    (word) => ABBREVIATIONS_WORDS.includes(word) && !allowlist.includes(word),
  );
  return found ?? null;
}

export function countNameWords(name: string, entityPrefix: string | null): number {
  const words = splitWords(name);
  const prefixWords = entityPrefix === null ? [] : splitWords(entityPrefix);
  const hasPrefix = prefixWords.every((word, position) => words[position] === word);
  return hasPrefix ? words.length - prefixWords.length : words.length;
}

function matchesShape(name: string, shape: "upper-snake" | "camel" | "pascal"): boolean {
  if (shape === "upper-snake") {
    return /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(name);
  }
  if (shape === "camel") {
    return /^[a-z][a-zA-Z0-9]*$/.test(name);
  }
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
}

function describeShape(shape: "upper-snake" | "camel" | "pascal", lead: string): string {
  if (shape === "upper-snake") {
    return "UPPER_SNAKE";
  }
  return shape === "camel" ? "camelCase" : `${lead}PascalCase`;
}

function endsAtBoundary(rest: string, shape: "upper-snake" | "camel" | "pascal"): boolean {
  if (shape === "pascal") {
    return rest === "" || /^[A-Z]/.test(rest);
  }
  if (shape === "camel") {
    return /^[A-Z]/.test(rest);
  }
  return rest !== "";
}

export function checkEntityPrefix(
  name: string,
  options: {
    kind: "constant" | "type";
    entity: string | null;
    constantCase: "upper-snake" | "camel";
    interfacePrefix: "" | "I";
    entityPrefix: boolean;
  },
): string | null {
  const shape = options.kind === "type" ? "pascal" : options.constantCase;
  const lead = options.kind === "type" ? options.interfacePrefix : "";
  if (options.entity !== null && options.entityPrefix) {
    const separator = shape === "upper-snake" ? "_" : "";
    const expected = lead + toEntityCase(options.entity, shape) + separator;
    if (!name.startsWith(expected) || !endsAtBoundary(name.slice(expected.length), shape)) {
      return `${name} should start with ${expected}`;
    }
  }
  const body = name.startsWith(lead) ? name.slice(lead.length) : "";
  return matchesShape(body, shape) ? null : `${name} should be ${describeShape(shape, lead)}`;
}
