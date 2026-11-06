import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { json } from "../lib/http.js";
import { subFromEvent } from "../lib/auth.js";
import { docClient, tableName } from "../lib/db.js";
import { makeNotifsRepo, type NotifsRepo } from "./repo.js";

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

export function makeHandler(repo: Pick<NotifsRepo, "list" | "unreadCount" | "markAllRead">) {
  return async (event: Event) => {
    const me = subFromEvent(event);
    switch (event.routeKey) {
      case "GET /notifications": {
        const [items, unread] = await Promise.all([repo.list(me), repo.unreadCount(me)]);
        return json(200, { items, unread });
      }
      case "POST /notifications/read":
        await repo.markAllRead(me);
        return json(200, { unread: 0 });
      default:
        return json(404, { error: `no route ${event.routeKey}` });
    }
  };
}

let real: ReturnType<typeof makeHandler> | undefined;
export const handler = (event: Event) => (real ??= makeHandler(makeNotifsRepo(docClient(), tableName())))(event);
