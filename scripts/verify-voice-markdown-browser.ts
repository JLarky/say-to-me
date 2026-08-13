import { resolve } from "node:path";
import { build } from "vite-plus";

const result = await build({
  configFile: false,
  logLevel: "error",
  root: process.cwd(),
  resolve: { conditions: ["browser", "import", "module", "default"] },
  build: {
    write: false,
    rollupOptions: {
      input: resolve("server/embed/solid/components/VoiceNoteMarkdown.browser-entry.ts"),
      output: { format: "es" },
    },
  },
});

const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) =>
  "output" in item ? item.output : [],
);
const chunks = outputs.filter((item) => item.type === "chunk");
if (chunks.length === 0)
  throw new Error("VoiceNoteMarkdown browser build emitted no JavaScript chunk");
const code = chunks.map((item) => item.code).join("\n");
if (code.length < 1_000) throw new Error("VoiceNoteMarkdown browser build emitted an empty entry");
for (const forbidden of ["satteri", "marked", "@bruits/satteri-wasm32-wasi"]) {
  if (code.includes(forbidden)) {
    throw new Error(`VoiceNoteMarkdown browser bundle references forbidden parser: ${forbidden}`);
  }
}
console.log(`VoiceNoteMarkdown server-HTML browser import OK (${code.length} bytes unminified)`);
