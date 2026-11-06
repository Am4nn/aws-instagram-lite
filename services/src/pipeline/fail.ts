import { docClient, tableName } from "../lib/db.js";
import { makePostsRepo } from "../posts/repo.js";

/** Step Functions Catch output: the original input plus `error: { Error, Cause }`. */
type Input = { postId: string; error?: { Error?: string; Cause?: string } };

function describe(error: Input["error"]): string {
  let message = error?.Cause ?? "";
  try {
    message = JSON.parse(message).errorMessage ?? message; // Lambda errors arrive as a JSON string
  } catch { /* plain text cause */ }
  return `${error?.Error ?? "Error"}: ${message}`;
}

export function makeFail(markFailed: (postId: string, reason: string) => Promise<boolean>) {
  return async (input: Input) => {
    await markFailed(input.postId, describe(input.error));
    return { postId: input.postId, failed: true };
  };
}

export const handler = makeFail((id, reason) => makePostsRepo(docClient(), tableName()).markFailed(id, reason));
