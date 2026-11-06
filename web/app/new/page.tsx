"use client";

import { useState, type FormEvent } from "react";
import { Nav } from "../../components/Nav";
import { api, ApiError, type Post } from "../../lib/api";

type Phase = "idle" | "uploading" | "processing" | "failed";
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX = 5 * 1024 * 1024;

/** Create post → PUT the file straight to S3 → poll until the pipeline marks it READY. */
export default function NewPost() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [caption, setCaption] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");

  function pick(f: File | undefined) {
    setError("");
    if (!f) return;
    if (!TYPES.includes(f.type)) return setError("Pick a JPEG, PNG or WebP image.");
    if (f.size > MAX) return setError("Max 5 MB.");
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError("");
    try {
      setPhase("uploading");
      const { postId, uploadUrl } = await api<{ postId: string; uploadUrl: string }>("/posts", {
        method: "POST", body: JSON.stringify({ caption, contentType: file.type }),
      });
      const put = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type } });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      setPhase("processing");
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const post = await api<Post>(`/posts/${postId}`);
        if (post.status === "READY") return void (window.location.href = "/me");
        if (post.status === "FAILED") throw new Error(post.failReason ?? "Processing failed");
      }
      throw new Error("Still processing. Check your profile in a minute.");
    } catch (err) {
      setPhase("failed");
      setError(err instanceof ApiError && err.status === 404 ? "Choose a username first." : (err as Error).message);
    }
  }

  const busy = phase === "uploading" || phase === "processing";
  return (
    <>
      <Nav />
      <main>
        <form className="card" onSubmit={submit}>
          <h2>New post</h2>
          <label>
            Photo
            <input type="file" accept={TYPES.join(",")} onChange={(e) => pick(e.target.files?.[0])} disabled={busy} />
          </label>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview && <img className="preview" src={preview} alt="preview" />}
          <label>
            Caption
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} rows={3} disabled={busy} />
          </label>
          <p className="error" role="alert">{error}</p>
          <button type="submit" disabled={!file || busy}>
            {phase === "uploading" ? "Uploading…" : phase === "processing" ? "Processing…" : "Share"}
          </button>
        </form>
      </main>
    </>
  );
}
