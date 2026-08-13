import { type as arktype } from "arktype";
import { describe, expect, it } from "vite-plus/test";
import { formatArkErrors } from "./ark-errors.ts";
import { parseJson, safeJsonParse, safeJsonParseWithError } from "./safe-json-parse.ts";

const Example = arktype({
  cwd: "string",
});

describe("safeJsonParse", () => {
  it("returns validated data for matching json", () => {
    expect(safeJsonParse(Example, '{"cwd":"/tmp"}')).toEqual({ cwd: "/tmp" });
  });

  it("returns null for invalid json or schema mismatch", () => {
    expect(safeJsonParse(Example, "not json")).toBeNull();
    expect(safeJsonParse(Example, "[]")).toBeNull();
  });

  it("parseJson throws on invalid input", () => {
    expect(() => parseJson(Example, "not json")).toThrow();
  });

  it("retains syntax and ArkType errors", () => {
    const syntax = safeJsonParseWithError(Example, "not json");
    expect(syntax.ok).toBe(false);
    if (syntax.ok) throw new Error("expected a syntax error");
    expect(syntax.error).toBeInstanceOf(SyntaxError);

    const schema = safeJsonParseWithError(Example, "[]");
    expect(schema.ok).toBe(false);
    if (schema.ok) throw new Error("expected a schema error");
    if (!(schema.error instanceof arktype.errors)) throw new Error("expected ArkType errors");
    expect(formatArkErrors(schema.error)).toContain("cwd");
  });

  it("formats ArkType validation errors", () => {
    const result = Example({ cwd: 42 });
    if (!(result instanceof arktype.errors)) throw new Error("expected ArkType errors");
    expect(formatArkErrors(result)).toContain("cwd");
  });
});
