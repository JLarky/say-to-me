import { defineRule } from "@oxlint/plugins";

import { isGlobalJsonMethodCall } from "../shared/json-method.ts";

/** Ban JSON.parse, which yields an untyped value instead of a decoded domain type. */
export const noJsonParseRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow JSON.parse; decode JSON text with `decodeJsonText` and a real schema, or HTTP bodies with `decodeResponseJson`.",
    },
    messages: {
      jsonParse:
        "Replace `JSON.parse` with `decodeJsonText` and a real schema (object, struct, or union of known shapes), or `decodeResponseJson` for HTTP bodies. Do not decode JSON into an untyped value.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (isGlobalJsonMethodCall(context.sourceCode, node.callee, "parse")) {
          context.report({ node, messageId: "jsonParse" });
        }
      },
    };
  },
});
