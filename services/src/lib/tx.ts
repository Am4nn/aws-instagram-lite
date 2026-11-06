/**
 * DynamoDB cancels a transaction for two very different reasons:
 *  1. our condition failed: the change was already made (e.g. already liked): fine, report false
 *  2. it collided with another transaction on the same item (TransactionConflict): transient
 * Emulators only show (1); real DynamoDB shows (2) on hot items (a viral post's likeCount).
 * So after a cancellation we look at the actual state to decide, and retry conflicts with jitter.
 *
 * @param write       the transaction
 * @param alreadyDone reads the current state: true if the desired end state already holds
 * @returns true if this call made the change, false if it was already done
 */
export async function conditionalWrite(
  write: () => Promise<unknown>, alreadyDone: () => Promise<boolean>, attempts = 4,
): Promise<boolean> {
  for (let i = 0; ; i++) {
    try {
      await write();
      return true;
    } catch (e) {
      if ((e as Error).name !== "TransactionCanceledException") throw e;
      if (await alreadyDone()) return false;
      if (i >= attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, Math.random() * 25 * 2 ** i)); // full jitter backoff
    }
  }
}
