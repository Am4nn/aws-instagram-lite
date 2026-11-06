import {
  DynamoDBDocumentClient, GetCommand, TransactWriteCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ProfileInput } from "./validate.js";

export type Profile = {
  userId: string;
  username: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: string;
};

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`username taken: ${username}`);
    this.name = "UsernameTakenError";
  }
}

// Keys (see the design doc's single-table section)
export const profileKey = (userId: string) => ({ pk: `USER#${userId}`, sk: "PROFILE" });
export const claimKey = (username: string) => ({ pk: `UNAME#${username}`, sk: "UNAME" });

const toProfile = (item: Record<string, unknown>): Profile => ({
  userId: item.userId as string,
  username: item.username as string,
  bio: (item.bio as string) ?? "",
  followerCount: (item.followerCount as number) ?? 0,
  followingCount: (item.followingCount as number) ?? 0,
  postCount: (item.postCount as number) ?? 0,
  createdAt: item.createdAt as string,
});

export type UsersRepo = ReturnType<typeof makeUsersRepo>;

export function makeUsersRepo(doc: DynamoDBDocumentClient, table: string) {
  async function getProfile(userId: string): Promise<Profile | null> {
    const { Item } = await doc.send(new GetCommand({ TableName: table, Key: profileKey(userId), ConsistentRead: true }));
    return Item ? toProfile(Item) : null;
  }

  async function getProfileByUsername(username: string): Promise<Profile | null> {
    const { Item } = await doc.send(new GetCommand({ TableName: table, Key: claimKey(username) }));
    return Item ? getProfile(Item.userId as string) : null;
  }

  /** Turns a cancelled transaction into UsernameTakenError when someone else owns the name. */
  async function explain(e: unknown, userId: string, username: string): Promise<never> {
    if ((e as Error).name === "TransactionCanceledException") {
      const { Item } = await doc.send(new GetCommand({ TableName: table, Key: claimKey(username), ConsistentRead: true }));
      if (Item && Item.userId !== userId) throw new UsernameTakenError(username);
    }
    throw e;
  }

  /**
   * Create or edit a profile. Username uniqueness = a claim item `UNAME#<name>`
   * written with attribute_not_exists in the same transaction as the profile.
   */
  async function upsertProfile(userId: string, input: ProfileInput): Promise<Profile> {
    const current = await getProfile(userId);
    const now = new Date().toISOString();

    if (!current) {
      const item = {
        ...profileKey(userId), type: "profile", userId, username: input.username, bio: input.bio,
        followerCount: 0, followingCount: 0, postCount: 0, createdAt: now,
      };
      await doc.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: table, Item: { ...claimKey(input.username), userId },
          ConditionExpression: "attribute_not_exists(pk)" } },
        { Put: { TableName: table, Item: item, ConditionExpression: "attribute_not_exists(pk)" } },
      ] })).catch((e) => explain(e, userId, input.username));
      return toProfile(item);
    }

    if (current.username === input.username) {
      const { Attributes } = await doc.send(new UpdateCommand({
        TableName: table, Key: profileKey(userId),
        UpdateExpression: "SET bio = :bio", ExpressionAttributeValues: { ":bio": input.bio },
        ReturnValues: "ALL_NEW",
      }));
      return toProfile(Attributes!);
    }

    // Rename: take the new claim, release the old one, update the profile. All or nothing.
    await doc.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: table, Item: { ...claimKey(input.username), userId },
        ConditionExpression: "attribute_not_exists(pk)" } },
      { Delete: { TableName: table, Key: claimKey(current.username),
        ConditionExpression: "userId = :me", ExpressionAttributeValues: { ":me": userId } } },
      { Update: { TableName: table, Key: profileKey(userId),
        UpdateExpression: "SET username = :new, bio = :bio",
        ConditionExpression: "username = :old",
        ExpressionAttributeValues: { ":new": input.username, ":bio": input.bio, ":old": current.username } } },
    ] })).catch((e) => explain(e, userId, input.username));
    return { ...current, username: input.username, bio: input.bio };
  }

  return { getProfile, getProfileByUsername, upsertProfile };
}
