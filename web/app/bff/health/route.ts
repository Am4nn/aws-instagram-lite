import { NextResponse } from "next/server";
import { callApi } from "../../../lib/server/api";

/** GET → is the HTTP API up? (The login page shows "API online".) */
export async function GET() {
  const ok = await callApi("/health", undefined).then((r) => r.ok, () => false);
  return NextResponse.json({ ok }, { status: ok ? 200 : 502, headers: { "cache-control": "no-store" } });
}
