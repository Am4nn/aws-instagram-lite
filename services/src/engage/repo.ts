import { randomUUID } from "node:crypto";
import {
  BatchGetCommand, DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { postKey, type Post } from "../posts/repo.js";
import { conditionalWrite } from "../lib/tx.js";

export type Comment = { commentId: string; postId: string; userId: string; username: string; text: string; createdAt: string };

export const likeKey = (postId: string, userId: string) => ({ pk: `POST#${postId}`, sk: `LIKE#${userId}` });

/** Comment page cursor: base64url of the last sort key (opaque to clients). */
const encode = (sk: string) => Buffer.from(sk).toString("base64url");
const decode = (c: string) => Buffer.from(c, "base64url").toString("utf8");

export type EngageRepo = ReturnType<typeof makeEngageRepo>;

export function makeEngageRepo(doc: DynamoDBDocumentClient, table: string) {
  const bump = (postId: string, field: string, delta: number) => ({
    Update: {
      TableName: table, Key: postKey(postId),
      ConditionExpression: "#s = :ready", UpdateExpression: `ADD ${field} :d`,
      ExpressionAttributeNames: { "#s": "status" }, ExpressionAttributeValues: { ":ready": "READY", ":d": delta },
    },
  });

  /**
   * true = new like. The like item and the counter change in one transaction, so the count is
   * always exact. The item also stores the post author, so the change stream can notify them.
   */
  const likeExists = async (postId: string, userId: string) =>
    Boolean((await doc.send(new GetCommand({ TableName: table, Key: likeKey(postId, userId), ConsistentRead: true }))).Item);

  async function like(post: Post, userId: string): Promise<boolean> {
    return conditionalWrite(() =>
      doc.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: table, ConditionExpression: "attribute_not_exists(pk)",
          Item: { ...likeKey(post.postId, userId), type: "like", postId: post.postId, userId,
            postAuthorId: post.userId, createdAt: new Date().toISOString() } } },
        bump(post.postId, "likeCount", 1),
      ] })),
    () => likeExists(post.postId, userId));
  }

  async function unlike(postId: string, userId: string): Promise<boolean> {
    return conditionalWrite(() =>
      doc.send(new TransactWriteCommand({ TransactItems: [
        { Delete: { TableName: table, Key: likeKey(postId, userId), ConditionExpression: "attribute_exists(pk)" } },
        bump(postId, "likeCount", -1),
      ] })),
    async () => !(await likeExists(postId, userId)));
  }

  /** Which of these posts has this user liked? One BatchGet for a whole feed page. */
  async function likedBy(postIds: string[], userId: string): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = 0; i < postIds.length; i += 100) {
      const keys = postIds.slice(i, i + 100).map((id) => likeKey(id, userId));
      if (!keys.length) continue;
      const r = await doc.send(new BatchGetCommand({ RequestItems: { [table]: { Keys: keys, ProjectionExpression: "postId" } } }));
      for (const item of r.Responses?.[table] ?? []) out.add(item.postId as string);
    }
    return out;
  }

  async function addComment(post: Post, user: { userId: string; username: string }, text: string): Promise<Comment> {
    const createdAt = new Date().toISOString();
    const commentId = randomUUID();
    const c: Comment = { commentId, postId: post.postId, userId: user.userId, username: user.username, text, createdAt };
    await doc.send(new TransactWriteCommand({ TransactItems: [
      // username is copied in (denormalised) so listing comments needs no extra lookups
      { Put: { TableName: table, Item: { pk: `POST#${post.postId}`, sk: `COMMENT#${createdAt}#${commentId}`,
        type: "comment", postAuthorId: post.userId, ...c } } },
      bump(post.postId, "commentCount", 1),
    ] }));
    return c;
  }

  async function listComments(postId: string, after?: string, limit = 20): Promise<{ items: Comment[]; next?: string }> {
    const r = await doc.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: after ? "pk = :pk AND sk BETWEEN :from AND :to" : "pk = :pk AND begins_with(sk, :p)",
      ExpressionAttributeValues: after
        ? { ":pk": `POST#${postId}`, ":from": `${decode(after)}~`, ":to": "COMMENT#~" }
        : { ":pk": `POST#${postId}`, ":p": "COMMENT#" },
      Limit: limit + 1, // one extra tells us whether there is a next page
    }));
    const rows = r.Items ?? [];
    const items = rows.slice(0, limit).map((i) => ({
      commentId: i.commentId, postId: i.postId, userId: i.userId, username: i.username, text: i.text, createdAt: i.createdAt,
    }) as Comment);
    const last = rows[limit - 1];
    return rows.length > limit && last ? { items, next: encode(last.sk as string) } : { items };
  }

  return { like, unlike, likedBy, addComment, listComments };
}
