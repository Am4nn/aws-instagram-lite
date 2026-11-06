import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { json } from "../lib/http.js";
import { subFromEvent, parseBody } from "../lib/auth.js";
import { docClient, tableName } from "../lib/db.js";
import { makeUsersRepo, UsernameTakenError, type UsersRepo } from "./repo.js";
import { normalizeUsername, validateProfileInput } from "./validate.js";
import { makeFollowsRepo } from "../social/repo.js";

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

export function makeHandler(
  repo: UsersRepo,
  isFollowing: (me: string, other: string) => Promise<boolean> = async () => false,
) {
  return async (event: Event) => {
    switch (event.routeKey) {
      case "GET /me": {
        const profile = await repo.getProfile(subFromEvent(event));
        return profile ? json(200, profile) : json(404, { error: "no profile yet" });
      }
      case "PUT /me": {
        const body = parseBody(event);
        if (body === null) return json(400, { error: "invalid JSON" });
        const input = validateProfileInput(body);
        if (!input.ok) return json(400, { error: input.error });
        try {
          return json(200, await repo.upsertProfile(subFromEvent(event), input.value));
        } catch (e) {
          if (e instanceof UsernameTakenError) return json(409, { error: "username taken" });
          throw e;
        }
      }
      case "GET /users/{username}": {
        const profile = await repo.getProfileByUsername(normalizeUsername(event.pathParameters?.username ?? ""));
        if (!profile) return json(404, { error: "user not found" });
        const me = subFromEvent(event);
        return json(200, { ...profile, isFollowing: me !== profile.userId && (await isFollowing(me, profile.userId)) });
      }
      default:
        return json(404, { error: `no route ${event.routeKey}` });
    }
  };
}

let real: ReturnType<typeof makeHandler> | undefined;
export const handler = (event: Event) =>
  (real ??= makeHandler(makeUsersRepo(docClient(), tableName()), makeFollowsRepo(docClient(), tableName()).isFollowing))(event);
