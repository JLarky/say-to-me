import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;
type BroadAssertionKind = "unknown" | "object" | "any";

function unwrapTypeParentheses(type: ESTree.TSType): ESTree.TSType {
  let current = type;
  while (current.type === "TSParenthesizedType") current = current.typeAnnotation;
  return current;
}

function broadAssertionKind(type: ESTree.TSType): BroadAssertionKind | null {
  const unwrapped = unwrapTypeParentheses(type);
  if (unwrapped.type === "TSUnknownKeyword") return "unknown";
  if (unwrapped.type === "TSObjectKeyword") return "object";
  if (unwrapped.type === "TSAnyKeyword") return "any";
  return null;
}

/** Ban type assertions to unknown, object, or any, which discard evidence instead of decoding. */
export const noBroadTypeAssertionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow TypeScript assertions to unknown, object, or any; parse the value into a named domain type.",
    },
    messages: {
      unknownAssertion:
        "Do not assert `as unknown`. Parse the value into a named domain type at its boundary.",
      objectAssertion:
        "Do not assert `as object`. Parse the value into a named domain type at its boundary.",
      anyAssertion:
        "Do not assert `as any`. Parse the value into a named domain type at its boundary.",
    },
  },
  createOnce(context) {
    const checkAssertion = (node: TypeAssertion) => {
      const kind = broadAssertionKind(node.typeAnnotation);
      if (kind === null) return;
      context.report({
        node,
        messageId:
          kind === "unknown"
            ? "unknownAssertion"
            : kind === "object"
              ? "objectAssertion"
              : "anyAssertion",
      });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
