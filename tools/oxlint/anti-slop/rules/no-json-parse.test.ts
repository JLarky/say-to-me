import { RuleTester } from "oxlint/plugins-dev";

import { noJsonParseRule } from "./no-json-parse.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "jsonParse" };

tester.run("anti-slop/no-json-parse", noJsonParseRule, {
  valid: [
    "const text = JSON.stringify(value);",
    "const text = JSON['stringify'](value);",
    "const JSON = { parse() { return 1; } }; JSON.parse();",
    "function read(JSON: { parse(): number }) { return JSON.parse(); }",
    "const value = Schema.decodeUnknownSync(Schema.fromJsonString(schema))(text);",
    "const value = await decodeResponseJson(response, schema);",
  ],
  invalid: [
    { name: "static access", code: "const value = JSON.parse(text);", errors: [error] },
    { name: "computed access", code: "const value = JSON['parse'](text);", errors: [error] },
    { name: "computed double quotes", code: 'const value = JSON["parse"](text);', errors: [error] },
  ],
});
