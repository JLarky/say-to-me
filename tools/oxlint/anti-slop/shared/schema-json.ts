import { resolveVariable } from "./scope.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

function isEffectSchemaBinding(sourceCode: SourceCode, expression: ESTree.Node): boolean {
  if (expression.type !== "Identifier") return false;
  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || variable.defs.length === 0) return false;
  return variable.defs.some((definition) => {
    if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
      return false;
    }
    if (definition.parent.source.value !== "effect") return false;
    return importedName(definition.node) === "Schema";
  });
}

function isJsonProperty(property: ESTree.Node, computed: boolean): boolean {
  if (computed) {
    return property.type === "Literal" && property.value === "Json";
  }
  return property.type === "Identifier" && property.name === "Json";
}

/** Reports whether a member access is Effect `Schema.Json` (not `Schema.JsonObject`). */
export function isEffectSchemaJsonAccess(sourceCode: SourceCode, node: ESTree.Node): boolean {
  if (node.type === "TSQualifiedName") {
    return node.right.name === "Json" && isEffectSchemaBinding(sourceCode, node.left);
  }
  if (!("property" in node) || !("object" in node) || !("computed" in node)) return false;
  return isEffectSchemaBinding(sourceCode, node.object) && isJsonProperty(node.property, node.computed);
}
