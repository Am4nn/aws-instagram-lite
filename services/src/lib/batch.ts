import { BatchGetCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * BatchGet in chunks of 100. Under throttling DynamoDB returns some keys as "unprocessed":
 * retry those with exponential backoff, and THROW if any remain, because silently dropping keys
 * makes callers think items don't exist (e.g. "not following" → posts skipped from a feed page).
 */
export async function batchGetAll(
  doc: DynamoDBDocumentClient, table: string, keys: Record<string, unknown>[], projection?: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    let pending: Record<string, unknown>[] | undefined = keys.slice(i, i + 100);
    for (let attempt = 0; pending?.length; attempt++) {
      if (attempt >= 6) throw new Error(`${pending.length} keys still unprocessed after retries (throttled)`);
      if (attempt) await new Promise((r) => setTimeout(r, Math.random() * 50 * 2 ** attempt));
      const r = await doc.send(new BatchGetCommand({
        RequestItems: { [table]: { Keys: pending, ...(projection ? { ProjectionExpression: projection } : {}) } },
      }));
      out.push(...(r.Responses?.[table] ?? []));
      pending = r.UnprocessedKeys?.[table]?.Keys as Record<string, unknown>[] | undefined;
    }
  }
  return out;
}
