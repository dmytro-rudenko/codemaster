export function splitWords(name: string): string[] {
  return name
    .replace(/([A-Z])(?=[A-Z][a-z])/g, "$1 ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-$]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

export function toEntityCase(entity: string, style: "upper-snake" | "camel" | "pascal"): string {
  const words = splitWords(entity);
  if (style === "upper-snake") {
    return words.join("_").toUpperCase();
  }
  const pascal = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  return style === "pascal" ? pascal : pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
