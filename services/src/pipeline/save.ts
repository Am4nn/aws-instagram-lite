import { docClient, tableName } from "../lib/db.js";
import { makePostsRepo, type Media } from "../posts/repo.js";

type Input = { postId: string; media: Media } & Record<string, unknown>;

/** Marks the post READY. If it already was (a retry), says so instead of counting it twice. */
export function makeSave(markReady: (postId: string, media: Media) => Promise<boolean>) {
  return async (input: Input) => ({ ...input, alreadyDone: !(await markReady(input.postId, input.media)) });
}

export const handler = makeSave((id, media) => makePostsRepo(docClient(), tableName()).markReady(id, media));
