import { defineRule } from "@oxlint/plugins";

import { isEffectSchemaJsonAccess } from "../shared/schema-json.ts";

/** Ban Schema.Json, which is as untyped as `as unknown`. */
export const noSchemaJsonRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Effect `Schema.Json`; decode JSON with a real schema (object, struct, or union of known shapes).",
    },
    messages: {
      schemaJson:
        "Do not use `Schema.Json`; it is as untyped as `as unknown`. Pass a real schema (object, struct, or union of known shapes) to `decodeJsonText` or `decodeResponseJson`.",
    },
  },
  createOnce(context) {
    const report = (node: Parameters<typeof isEffectSchemaJsonAccess>[1]) => {
      if (isEffectSchemaJsonAccess(context.sourceCode, node)) {
        context.report({ node, messageId: "schemaJson" });
      }
    };

    return {
      MemberExpression: report,
      TSQualifiedName: report,
    };
  },
});
