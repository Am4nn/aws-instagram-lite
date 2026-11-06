import { describe, it, expect } from "vitest";
import type { SQSEvent } from "aws-lambda";
import { makeNotify } from "./worker.js";
import type { NewNotif } from "./repo.js";

const msg = (detailType: string, detail: unknown, id = "m0", time = "2026-01-01T00:00:00Z") =>
  ({ messageId: id, body: JSON.stringify({ "detail-type": detailType, time, detail }) });
const batch = (...r: ReturnType<typeof msg>[]) => ({ Records: r }) as unknown as SQSEvent;

function setup() {
  const stored: NewNotif[] = [];
  const pushed: { recipientId: string; text: string }[] = [];
  const notify = makeNotify({
    getUsername: async (id) => `${id}_name`,
    put: async (x) => { stored.push(x); },
    publish: async (recipientId, text) => { pushed.push({ recipientId, text }); },
  });
  return { notify, stored, pushed };
}

describe("notify worker", () => {
  it("like → notification for the post author, with the actor's username, + SNS publish", async () => {
    const { notify, stored, pushed } = setup();
    await notify(batch(msg("PostLiked", { postId: "p1", authorId: "alice", actorId: "carol" })));
    expect(stored).toEqual([expect.objectContaining({
      recipientId: "alice", type: "PostLiked", actorId: "carol", actorUsername: "carol_name", postId: "p1", at: "2026-01-01T00:00:00Z",
    })]);
    expect(pushed).toEqual([{ recipientId: "alice", text: "carol_name liked your post" }]);
  });

  it("comment and follow notify the right person", async () => {
    const { notify, stored } = setup();
    await notify(batch(
      msg("PostCommented", { postId: "p1", authorId: "alice", actorId: "carol", commentId: "c1", text: "nice" }, "m0"),
      msg("UserFollowed", { followerId: "bob", followeeId: "alice" }, "m1"),
    ));
    expect(stored.map((s) => [s.recipientId, s.type, s.actorId])).toEqual([["alice", "PostCommented", "carol"], ["alice", "UserFollowed", "bob"]]);
    expect(stored[0].text).toBe("nice");
  });

  it("never notifies you about your own actions", async () => {
    const { notify, stored } = setup();
    await notify(batch(msg("PostLiked", { postId: "p1", authorId: "alice", actorId: "alice" })));
    expect(stored).toEqual([]);
  });

  it("derives a stable sourceKey per event (so redelivery overwrites instead of duplicating)", async () => {
    const { notify, stored } = setup();
    const m = msg("PostCommented", { postId: "p1", authorId: "alice", actorId: "carol", commentId: "c1", text: "x" });
    await notify(batch(m));
    await notify(batch(m));
    expect(stored[0].sourceKey).toBe(stored[1].sourceKey);
  });

  it("reports only broken messages as failures", async () => {
    const { notify } = setup();
    expect(await notify(batch(msg("Other", {}), { messageId: "bad", body: "{" } as ReturnType<typeof msg>)))
      .toEqual({ batchItemFailures: [{ itemIdentifier: "bad" }] });
  });
});
