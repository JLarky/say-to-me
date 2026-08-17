import { internalApiToken } from "../claude/internal-api-token.ts";
/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- Internal worker request bodies are validated field-by-field before actions run. */

type JsonRecord = Record<string, unknown>;

export type ExternalCliDeliveryLease = {
  id: number;
  messageId: number;
  messageSessionId: string;
  kind: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  lockedAt: number | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExternalCliDeliveryInternalConfig<TLease extends ExternalCliDeliveryLease> = {
  backendLabel: string;
  basePath: `/api/internal/${string}-delivery`;
  sessionIdField: string;
  sessionIdLeaseField: keyof TLease & string;
  workerVersion: number;
  scheduleWorkerReplacement: (sessionId: string) => Promise<void>;
  claimDeliveryJobForWorker: (workerId: string, sessionId?: string) => Promise<object | null>;
  completeDeliveryJobFromWorker: (job: TLease, reply: string | null) => Promise<boolean>;
  retryDeliveryJobFromWorker: (job: TLease, error: string) => Promise<boolean>;
  failDeliveryJobFromWorker: (job: TLease, error: string) => Promise<boolean>;
  cancelDeliveryJobFromWorker: (job: TLease, reason: string) => Promise<boolean>;
  renewDeliveryJobFromWorker: (job: TLease) => Promise<TLease | null>;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Internal response helper serializes its caller-owned payload without inspection.
function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, { status });
}

async function readJson(request: Request): Promise<JsonRecord | null> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as JsonRecord;
  } catch {
    return null;
  }
}

function stringField(body: JsonRecord, field: string): string | null {
  const value = body[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalStringField(body: JsonRecord, field: string): string | undefined {
  const value = body[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(body: JsonRecord, field: string): number | null {
  const value = body[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function leaseField<TLease extends ExternalCliDeliveryLease>(
  body: JsonRecord,
  sessionIdLeaseField: keyof TLease & string,
): TLease | null {
  const value = body.job;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<TLease>;
  if (
    typeof candidate.id !== "number" ||
    typeof candidate.messageId !== "number" ||
    typeof candidate.messageSessionId !== "string" ||
    typeof candidate[sessionIdLeaseField] !== "string" ||
    typeof candidate.kind !== "string" ||
    candidate.status !== "running" ||
    typeof candidate.attemptCount !== "number" ||
    typeof candidate.maxAttempts !== "number" ||
    typeof candidate.nextAttemptAt !== "number" ||
    typeof candidate.lockedAt !== "number" ||
    typeof candidate.lockedBy !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    ...candidate,
    lastError: typeof candidate.lastError === "string" ? candidate.lastError : null,
  } as TLease;
}

function authorized(request: Request): boolean {
  const token = internalApiToken();
  if (!token) return false;
  return request.headers.get("x-say-to-me-internal-token") === token;
}

export function createExternalCliDeliveryInternalDispatcher<
  TLease extends ExternalCliDeliveryLease,
>(config: ExternalCliDeliveryInternalConfig<TLease>) {
  return async function dispatchDeliveryInternalRequest(
    request: Request,
  ): Promise<Response | null> {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith(config.basePath)) return null;
    if (!authorized(request)) return error("Unauthorized.", 401);
    if (request.method !== "POST") return error("Method not allowed.", 405);

    const body = await readJson(request);
    if (!body) return error("Expected JSON object body.");

    if (pathname === `${config.basePath}/claim`) {
      const workerId = stringField(body, "workerId");
      if (!workerId) return error("Missing workerId.");
      if (numberField(body, "workerVersion") !== config.workerVersion) {
        const staleSessionId = optionalStringField(body, config.sessionIdField);
        if (staleSessionId) {
          void config.scheduleWorkerReplacement(staleSessionId).catch((cause: unknown) => {
            console.error(
              `[${config.backendLabel}-delivery] replacement scheduling failed for ${staleSessionId}:`,
              cause,
            );
          });
        }
        return error(
          `Stale ${config.backendLabel} delivery worker. Expected ${config.workerVersion}.`,
        );
      }
      const claimed = await config.claimDeliveryJobForWorker(
        workerId,
        optionalStringField(body, config.sessionIdField),
      );
      return json({ claimed });
    }

    if (pathname === `${config.basePath}/complete`) {
      const job = leaseField(body, config.sessionIdLeaseField);
      if (!job) return error("Missing valid job lease.");
      const reply = body.reply == null ? null : stringField(body, "reply");
      if (body.reply != null && reply == null) return error("Invalid reply.");
      return json({ ok: await config.completeDeliveryJobFromWorker(job, reply) });
    }

    if (pathname === `${config.basePath}/retry`) {
      const job = leaseField(body, config.sessionIdLeaseField);
      const message = stringField(body, "error");
      if (!job) return error("Missing valid job lease.");
      if (!message) return error("Missing error.");
      return json({ ok: await config.retryDeliveryJobFromWorker(job, message) });
    }

    if (pathname === `${config.basePath}/fail`) {
      const job = leaseField(body, config.sessionIdLeaseField);
      const message = stringField(body, "error");
      if (!job) return error("Missing valid job lease.");
      if (!message) return error("Missing error.");
      return json({ ok: await config.failDeliveryJobFromWorker(job, message) });
    }

    if (pathname === `${config.basePath}/cancel`) {
      const job = leaseField(body, config.sessionIdLeaseField);
      const reason = stringField(body, "reason");
      if (!job) return error("Missing valid job lease.");
      if (!reason) return error("Missing reason.");
      return json({ ok: await config.cancelDeliveryJobFromWorker(job, reason) });
    }

    if (pathname === `${config.basePath}/renew`) {
      const job = leaseField(body, config.sessionIdLeaseField);
      if (!job) return error("Missing valid job lease.");
      return json({ job: await config.renewDeliveryJobFromWorker(job) });
    }

    return error("Not found.", 404);
  };
}
