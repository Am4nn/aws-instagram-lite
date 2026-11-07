import { NextResponse, type NextRequest } from "next/server";
import { callApi, idToken } from "../../../../lib/server/api";
import { matchForward } from "../../../../lib/server/forward";
import { jsonError } from "../../../../lib/server/respond";

/**
 * The BFF forwarder: browser → /bff/api/<path> → HTTP API /<path>, with the ig_id cookie as Bearer token.
 * Only allowlisted routes (lib/server/forward.ts). proxy.ts has already checked Origin + JSON on mutations.
 */
type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: NextRequest, { params }: Ctx) {
  const path = matchForward(req.method, (await params).path);
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

export { forward as GET, forward as POST, forward as PUT, forward as DELETE };
