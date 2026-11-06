import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { json } from "../lib/http.js";
import { subFromEvent } from "../lib/auth.js";
import { docClient, tableName } from "../lib/db.js";
import { makeUsersRepo } from "../users/repo.js";
import { makeFollowsRepo, type FollowsRepo } from "./repo.js";

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

type Deps = {
  follows: Pick<FollowsRepo, "follow" | "unfollow">;
  userExists: (userId: string) => Promise<boolean>;
};

export function makeHandler(d: Deps) {
  return async (event: Event) => {
    const me = subFromEvent(event);
    const other = event.pathParameters?.userId ?? "";
    if (other === me) return json(400, { error: "you can't follow yourself" });
    switch (event.routeKey) {
      case "POST /users/{userId}/follow": {
        if (!(await d.userExists(other))) return json(404, { error: "user not found" });
        // No publish here: the new FOLLOWER# item reaches EventBridge as UserFollowed via the
        // DynamoDB stream (events/publisher.ts), so the DB write and the event can't diverge.
        await d.follows.follow(me, other);
        return json(200, { following: true });
      }
      case "DELETE /users/{userId}/follow":
        await d.follows.unfollow(me, other);
        return json(200, { following: false });
      default:
        return json(404, { error: `no route ${event.routeKey}` });
    }
  };
}

let real: ReturnType<typeof makeHandler> | undefined;
function realDeps(): Deps {
  const users = makeUsersRepo(docClient(), tableName());
  return {
    follows: makeFollowsRepo(docClient(), tableName()),
    userExists: async (id) => (await users.getProfile(id)) !== null,
  };
}
export const handler = (event: Event) => (real ??= makeHandler(realDeps()))(event);
