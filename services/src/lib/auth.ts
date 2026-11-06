import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

/** Caller's Cognito user id. API Gateway already verified the JWT before invoking us. */
export function subFromEvent(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
  if (typeof sub !== "string" || !sub) throw new Error("no sub claim (route missing JWT authorizer?)");
  return sub;
}

/** Parses a JSON body; undefined body → {}. Returns null on invalid JSON. */
export function parseBody(event: { body?: string; isBase64Encoded?: boolean }): unknown | null {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
