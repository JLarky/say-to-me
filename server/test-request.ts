const testRequestOrigin = "http://say.test";

export function createTestRequest(path: string, init?: RequestInit): Request {
  return new Request(new URL(path, testRequestOrigin), init);
}

export function expectHandledResponse(response: Response | null, request: Request): Response {
  if (response) return response;
  throw new Error(
    `Expected the API dispatcher to return a Response for ${request.method} ${request.url}.`,
  );
}
