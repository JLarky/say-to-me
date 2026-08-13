import "./tracing.ts"; // must be first — patches http/express before they load
import express from "express";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { closeApi, createApiMiddleware, dbPath } from "./api.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 5173);

const app = express();
app.use(createApiMiddleware());
app.use(express.static(path.join(root, "dist")));
app.get("*splat", (_req, res) => {
  res.sendFile(path.join(root, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`Say To Me running at http://localhost:${port}`);
  console.log(`SQLite queue: ${dbPath}`);
});

process.on("SIGINT", () => {
  void closeApi().finally(() => process.exit(0));
});
