import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { json } from "../lib/http.js";
import { subFromEvent, parseBody } from "../lib/auth.js";
import { docClient, tableName } from "../lib/db.js";
import { makePostsRepo, type Post } from "../posts/repo.js";
import { makeUsersRepo } from "../users/repo.js";
import { makeEngageRepo, type EngageRepo } from "./repo.js";

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
export const COMMENT_MAX = 500;

type Deps = {
  getPost: (postId: string) => Promise<Post | null>;
  getUsername: (userId: string) => Promise<string | null>;
  repo: Pick<EngageRepo, "like" | "unlike" | "addComment" | "listComments">;
};

export function makeHandler(d: Deps) {
  return async (event: Event) => {
    const me = subFromEvent(event);
    const post = await d.getPost(event.pathParameters?.id ?? "");
    if (!post || post.status !== "READY") return json(404, { error: "post not found" });

    switch (event.routeKey) {
      case "POST /posts/{id}/like":
      case "DELETE /posts/{id}/like": {
        const liking = event.routeKey.startsWith("POST");
        if (liking) await d.repo.like(post, me);
        else await d.repo.unlike(post.postId, me);
        const fresh = await d.getPost(post.postId);
        return json(200, { liked: liking, likeCount: fresh?.likeCount ?? 0 });
      }
      case "GET /posts/{id}/comments":
        return json(200, await d.repo.listComments(post.postId, event.queryStringParameters?.cursor));
      case "POST /posts/{id}/comments": {
        const body = parseBody(event) as { text?: unknown } | null;
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        if (!text || text.length > COMMENT_MAX) return json(400, { error: `comment must be 1-${COMMENT_MAX} chars` });
        const username = await d.getUsername(me);
        if (!username) return json(404, { error: "choose a username first" });
        return json(201, await d.repo.addComment(post, { userId: me, username }, text));
      }
      default:
        return json(404, { error: `no route ${event.routeKey}` });
    }
  };
}

let real: ReturnType<typeof makeHandler> | undefined;
export const handler = (event: Event) => {
  real ??= (() => {
    const doc = docClient();
    const table = tableName();
    const posts = makePostsRepo(doc, table);
    const users = makeUsersRepo(doc, table);
    return makeHandler({
      getPost: (id) => posts.get(id),
      getUsername: async (id) => (await users.getProfile(id))?.username ?? null,
      repo: makeEngageRepo(doc, table),
    });
  })();
  return real(event);
};
