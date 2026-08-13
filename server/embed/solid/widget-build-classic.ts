/** Node-only helper used by jsdom tests to print the minified classic widget IIFE. */
import { getEmbedWidgetScript } from "./widget.ts";

process.stdout.write(await getEmbedWidgetScript());
