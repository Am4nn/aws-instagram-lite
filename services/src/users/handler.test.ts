import { describe, it, expect } from "vitest";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { makeHandler } from "./handler.js";
import { UsernameTakenError, type Profile, type UsersRepo } from "./repo.js";

function fakeRepo(): UsersRepo {
  const byId = new Map<string, Profile>();
  return {
    async getProfile(id) { return byId.get(id) ?? null; },
    async getProfileByUsername(u) { return [...byId.values()].find((p) => p.username === u) ?? null; },
    async upsertProfile(id, input) {
      const owner = [...byId.values()].find((p) => p.username === input.username);
      if (owner && owner.userId !== id) throw new UsernameTakenError(input.username);
      const p: Profile = { followerCount: 0, followingCount: 0, postCount: 0, createdAt: "t",
        ...byId.get(id), userId: id, ...input };
      byId.set(id, p);
      return p;
    },
  };
}

const ev = (routeKey: string, opts: { sub?: string; body?: string; params?: Record<string, string> } = {}) =>
  ({
    routeKey,
    body: opts.body,
    pathParameters: opts.params,
    requestContext: { authorizer: { jwt: { claims: { sub: opts.sub ?? "u1" }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

const call = async (h: ReturnType<typeof makeHandler>, e: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const r = await h(e);
  return { status: r.statusCode, body: JSON.parse(r.body as string) };
};

describe("users handler", () => {
  it("GET /me → 404 before a profile exists", async () => {
    expect(await call(makeHandler(fakeRepo()), ev("GET /me"))).toEqual({ status: 404, body: { error: "no profile yet" } });
  });

  it("PUT /me creates the profile for the caller (sub from the JWT), then GET /me returns it", async () => {
    const h = makeHandler(fakeRepo());
    const put = await call(h, ev("PUT /me", { body: JSON.stringify({ username: "Ann", bio: "hi" }) }));
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ userId: "u1", username: "ann", bio: "hi" });
    expect((await call(h, ev("GET /me"))).body).toMatchObject({ username: "ann" });
  });

  it("PUT /me → 400 on invalid input or invalid JSON", async () => {
    const h = makeHandler(fakeRepo());
    expect((await call(h, ev("PUT /me", { body: JSON.stringify({ username: "x" }) }))).status).toBe(400);
    expect((await call(h, ev("PUT /me", { body: "{nope" }))).body).toEqual({ error: "invalid JSON" });
  });

  it("PUT /me → 409 when the username belongs to someone else", async () => {
    const h = makeHandler(fakeRepo());
    await call(h, ev("PUT /me", { sub: "u1", body: JSON.stringify({ username: "ann" }) }));
    expect(await call(h, ev("PUT /me", { sub: "u2", body: JSON.stringify({ username: "ann" }) })))
      .toEqual({ status: 409, body: { error: "username taken" } });
  });

  it("GET /users/{username} → profile, case-insensitive; 404 when unknown", async () => {
    const h = makeHandler(fakeRepo());
    await call(h, ev("PUT /me", { body: JSON.stringify({ username: "ann" }) }));
    expect((await call(h, ev("GET /users/{username}", { params: { username: "ANN" } }))).body).toMatchObject({ username: "ann" });
    expect((await call(h, ev("GET /users/{username}", { params: { username: "zed" } }))).status).toBe(404);
  });

  it("GET /users/{username} tells the caller whether they follow that user", async () => {
    const h = makeHandler(fakeRepo(), async (me, other) => me === "u2" && other === "u1");
    await call(h, ev("PUT /me", { sub: "u1", body: JSON.stringify({ username: "ann" }) }));
    expect((await call(h, ev("GET /users/{username}", { sub: "u2", params: { username: "ann" } }))).body)
      .toMatchObject({ username: "ann", isFollowing: true });
    expect((await call(h, ev("GET /users/{username}", { sub: "u3", params: { username: "ann" } }))).body)
      .toMatchObject({ isFollowing: false });
  });
});
