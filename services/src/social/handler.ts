import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { json } from "../lib/http.js";
import { subFromEvent } from "../lib/auth.js";
import { docClient, tableName } from "../lib/db.js";
import { makeUsersRepo } from "../users/repo.js";
import { makeFollowsRepo, type FollowsRepo } from "./repo.js";

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
export type UserFollowed = { followerId: string; followeeId: string };

type Deps = {
  follows: Pick<FollowsRepo, "follow" | "unfollow">;
  userExists: (userId: string) => Promise<boolean>;
  publish: (detail: UserFollowed) => Promise<void>;
};

export function makeHandler(d: Deps) {
  return async (event: Event) => {
    const me = subFromEvent(event);
    const other = event.pathParameters?.userId ?? "";
    if (other === me) return json(400, { error: "you can't follow yourself" });
    switch (event.routeKey) {
      case "POST /users/{userId}/follow": {
        if (!(await d.userExists(other))) return json(404, { error: "user not found" });
        // Only a *new* edge is news: the feed backfills and step 5 notifies.
        if (await d.follows.follow(me, other)) await d.publish({ followerId: me, followeeId: other });
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
  const eb = new EventBridgeClient({});
  return {
    follows: makeFollowsRepo(docClient(), tableName()),
    userExists: async (id) => (await users.getProfile(id)) !== null,
    publish: async (detail) => {
      await eb.send(new PutEventsCommand({ Entries: [{
        EventBusName: process.env.EVENT_BUS, Source: "ig.social", DetailType: "UserFollowed", Detail: JSON.stringify(detail),
      }] }));
    },
  };
}
export const handler = (event: Event) => (real ??= makeHandler(realDeps()))(event);
