import type { ErrorRequestHandler, RequestHandler, Response as ExpressResponse } from "express";
import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function errorStatus(error: unknown, fallback = 500): number {
  if (error && typeof error === "object") {
    const record = error as { status?: unknown; statusCode?: unknown };
    const status = typeof record.status === "number" ? record.status : record.statusCode;
    if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
      return status;
    }
  }
  return fallback;
}

function jsonErrorPayload(status: number, error: string) {
  return { status, error };
}

function jsonObjectFromBody(chunk: unknown): Record<string, unknown> | null {
  const text = Buffer.isBuffer(chunk)
    ? chunk.toString("utf8")
    : typeof chunk === "string"
      ? chunk
      : null;
  if (!text?.trim()) return null;
  const value = safeJsonParse(UnknownJson, text);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorTextFromBody(chunk: unknown, fallback: string): string {
  if (typeof chunk === "string" && chunk.trim()) return chunk;
  if (Buffer.isBuffer(chunk)) {
    const text = chunk.toString("utf8").trim();
    if (text) return text;
  }
  return fallback;
}

function normalizedErrorBody(status: number, chunk: unknown, hasJsonContentType: boolean): Buffer {
  const existingJson = hasJsonContentType ? jsonObjectFromBody(chunk) : null;
  const payload = existingJson
    ? Object.assign({ status }, existingJson, { status })
    : jsonErrorPayload(status, errorTextFromBody(chunk, `HTTP ${status}`));
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function isEndCallback(value: unknown): value is () => void {
  return typeof value === "function";
}

export function sendJsonError(res: ExpressResponse, status: number, error: string): void {
  if (res.headersSent) return;
  res.status(status).json(jsonErrorPayload(status, error));
}

export function jsonErrorResponseFallback(): RequestHandler {
  return (_req, res, next) => {
    const originalEnd = res.end.bind(res);
    res.end = ((chunk?: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
      const status = res.statusCode;
      const contentType = res.getHeader("content-type");
      const hasJsonContentType =
        typeof contentType === "string" && contentType.toLowerCase().includes("application/json");
      const hasBody =
        chunk != null &&
        !(typeof chunk === "string" && chunk.length === 0) &&
        !(Buffer.isBuffer(chunk) && chunk.length === 0);

      const existingJson = hasJsonContentType ? jsonObjectFromBody(chunk) : null;
      const hasStatus = typeof existingJson?.status === "number";
      if (
        status >= 400 &&
        status <= 599 &&
        (!hasBody || !hasJsonContentType || !hasStatus) &&
        !res.headersSent
      ) {
        const body = normalizedErrorBody(status, chunk, hasJsonContentType);
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("content-length", String(body.length));
        const done = isEndCallback(encodingOrCallback)
          ? encodingOrCallback
          : isEndCallback(callback)
            ? callback
            : undefined;
        return done ? originalEnd(body, done) : originalEnd(body);
      }

      if (isEndCallback(encodingOrCallback)) {
        return originalEnd(chunk as never, encodingOrCallback);
      }
      if (isEndCallback(callback)) {
        return originalEnd(chunk as never, encodingOrCallback as BufferEncoding, callback);
      }
      return encodingOrCallback == null
        ? originalEnd(chunk as never)
        : originalEnd(chunk as never, encodingOrCallback as BufferEncoding);
    }) as typeof res.end;
    next();
  };
}

export const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = errorStatus(error);
  sendJsonError(res, status, errorMessage(error, `HTTP ${status}`));
};
