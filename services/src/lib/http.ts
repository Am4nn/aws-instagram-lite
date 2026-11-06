import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

/** JSON response for API Gateway HTTP API (payload v2). */
export function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify(body),
  };
}
