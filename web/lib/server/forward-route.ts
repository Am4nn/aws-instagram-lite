import { NextResponse, type NextRequest } from "next/server";
import { callApi, idToken } from "./api";
import { matchForward } from "./forward";
import { jsonError } from "./respond";

/**
 * The BFF forwarder: browser → /bff/api/<path> → HTTP API /<path>, with the ig_id cookie as Bearer token.
 * Only allowlisted routes (forward.ts). proxy.ts has already checked Origin + JSON on mutations.
 * Mounted as app/bff/api/[a], [a]/[b] and [a]/[b]/[c] rather than one [...path] catch-all: Floci drops
 * files under a folder named "[...path]" from the Lambda zip (it looks like "..", see floci-compat.md).
 */
type Ctx = { params: Promise<Record<string, string>> };

export async function forward(req: NextRequest, { params }: Ctx) {
  const p = await params;
  const path = matchForward(req.method, [p.a, p.b, p.c].filter((s): s is string => s !== undefined));
  if (!path) return jsonError(404, "no such route");
  const token = await idToken();
  if (!token) return jsonError(401, "not signed in");
  const res = await callApi(`${path}${req.nextUrl.search}`, token, {
    method: req.method, body: req.method === "GET" ? undefined : await req.text(),
  });
  const body = await res.text();
  return new NextResponse(body || "{}", {
    status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
