# say-to-me2

## Environment variables

Do not parse `.env` files in app code (no `dotenv`, no `fs` read of `.env`). Native Bun/Node env loading only. `src/config.ts` may apply defaults and validation on `process.env`.

## Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.
