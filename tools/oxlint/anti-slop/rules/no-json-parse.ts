import { defineRule } from "@oxlint/plugins";

import { isGlobalJsonMethodCall } from "../shared/json-method.ts";

/** Ban JSON.parse, which yields an untyped value instead of a decoded domain type. */
export const noJsonParseRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow JSON.parse; decode JSON with Effect Schema (`Schema.fromJsonString`) or `decodeResponseJson` for HTTP bodies.",
    },
    messages: {
      jsonParse:
        "Replace `JSON.parse` with Effect Schema (`Schema.fromJsonString`) or `decodeResponseJson` for HTTP bodies. Do not decode JSON into an untyped value.",
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
