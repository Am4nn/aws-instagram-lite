import { describe, it, expect } from "vitest";
import { matchForward } from "./forward";

describe("matchForward (/bff/api/* → HTTP API allowlist)", () => {
  it.each([
    ["GET", ["feed"], "/feed"],
    ["GET", ["me"], "/me"],
    ["PUT", ["me"], "/me"],
    ["GET", ["users", "bob"], "/users/bob"],
    ["GET", ["users", "u-1", "posts"], "/users/u-1/posts"],
    ["POST", ["users", "u-1", "follow"], "/users/u-1/follow"],
    ["DELETE", ["users", "u-1", "follow"], "/users/u-1/follow"],
    ["POST", ["posts"], "/posts"],
    ["GET", ["posts", "p1"], "/posts/p1"],
    ["POST", ["posts", "p1", "like"], "/posts/p1/like"],
    ["DELETE", ["posts", "p1", "like"], "/posts/p1/like"],
    ["GET", ["posts", "p1", "comments"], "/posts/p1/comments"],
    ["POST", ["posts", "p1", "comments"], "/posts/p1/comments"],
    ["GET", ["notifications"], "/notifications"],
    ["POST", ["notifications", "read"], "/notifications/read"],
  ])("%s %j → %s", (method, segs, path) => {
    expect(matchForward(method, segs)).toBe(path);
  });

  it.each([
    ["PUT", ["posts", "x"]],
    ["DELETE", ["me"]],
    ["GET", ["..", "health"]],
    ["GET", ["users", "a/b"]],
    ["GET", ["users", "%2e%2e"]],
    ["GET", ["health"]], // public: served by /bff/health instead
    ["GET", []],
  ])("refuses %s %j", (method, segs) => {
    expect(matchForward(method, segs)).toBeNull();
  });
});
