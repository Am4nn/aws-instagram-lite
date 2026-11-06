"use client";

import { getIdToken, signOut } from "./auth";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Profile = {
  userId: string;
  username: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: string;
};

/** Calls our API with the Cognito ID token. A 401 means the session is gone: back to /login. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getIdToken();
  if (!token) {
    window.location.href = "/login";
    throw new ApiError(401, "not signed in");
  }
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  if (res.status === 401) {
    signOut();
    window.location.href = "/login";
    throw new ApiError(401, "session expired");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export type Post = {
  postId: string;
  userId: string;
  caption: string;
  status: "PENDING" | "READY" | "FAILED";
  createdAt: string;
  likeCount: number;
  commentCount: number;
  failReason?: string;
  thumbUrl?: string;
  fullUrl?: string;
};

export type FeedItem = Post & { author: { userId: string; username: string } };
