import { describe, it, expect } from "vitest";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { makeHandler } from "./handler.js";

function setup() {
  const edges = new Set<string>();
  const registered: string[] = [];
  const h = makeHandler({
    follows: {
      async follow(a, b) { const k = `${a}>${b}`; if (edges.has(k)) return false; edges.add(k); return true; },
      async unfollow(a, b) { return edges.delete(`${a}>${b}`); },
    },
    userExists: async (id) => id !== "ghost",
    registerCeleb: async (id) => { registered.push(id); },
  });
  return { h, edges, registered };
}

const ev = (routeKey: string, userId: string, sub = "me") =>
  ({ routeKey, pathParameters: { userId }, requestContext: { authorizer: { jwt: { claims: { sub }, scopes: [] } } } }) as unknown as
    APIGatewayProxyEventV2WithJWTAuthorizer;

const call = async (h: ReturnType<typeof makeHandler>, e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = await h(e);
  return { status: r.statusCode, body: JSON.parse(r.body as string) };
};

describe("social handler", () => {
  it("follow → 200 following:true, idempotent (UserFollowed now comes from the change stream)", async () => {
    const { h, edges, registered } = setup();
    expect(await call(h, ev("POST /users/{userId}/follow", "alice"))).toEqual({ status: 200, body: { following: true } });
    expect(await call(h, ev("POST /users/{userId}/follow", "alice"))).toEqual({ status: 200, body: { following: true } });
    expect([...edges]).toEqual(["me>alice"]);
    expect(registered).toEqual(["alice", "alice"]); // celeb check runs every time (self-heals a missed registration)
  });

  it("unfollow → 200 following:false (idempotent)", async () => {
    const { h, edges } = setup();
    edges.add("me>alice");
    expect((await call(h, ev("DELETE /users/{userId}/follow", "alice"))).body).toEqual({ following: false });
    expect((await call(h, ev("DELETE /users/{userId}/follow", "alice"))).status).toBe(200);
  });

  it("rejects following yourself (400) and unknown users (404)", async () => {
    const { h } = setup();
    expect((await call(h, ev("POST /users/{userId}/follow", "me"))).status).toBe(400);
    expect((await call(h, ev("POST /users/{userId}/follow", "ghost"))).status).toBe(404);
  });
});
