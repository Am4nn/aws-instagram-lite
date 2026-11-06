"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ImagePlus, RefreshCw } from "lucide-react";
import { Nav } from "../../components/Nav";
import { Spinner } from "../../components/ui/Spinner";
import { api, ApiError, type Post } from "../../lib/api";

type Phase = "idle" | "uploading" | "processing" | "failed";
// Mirrors services/src/posts/validate.ts (ALLOWED_TYPES, MAX_UPLOAD_BYTES, CAPTION_MAX).
const TYPES = ["image/jpeg", "image/png"];
const MAX = 5 * 1024 * 1024;
const CAPTION_MAX = 2200;

const mb = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Create post → PUT the file straight to S3 → poll until the pipeline marks it READY. */
export default function NewPost() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [caption, setCaption] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Free the previous blob URL when the preview changes / on leave.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pick(f: File | undefined) {
    setError("");
    if (!f) return;
    if (!TYPES.includes(f.type)) return setError("That file isn't a JPEG or PNG.");
    if (f.size > MAX) return setError(`That photo is ${mb(f.size)}. The limit is 5 MB.`);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    if (phase === "failed") setPhase("idle");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError("");
    try {
      setPhase("uploading");
      const { postId, uploadUrl } = await api<{ postId: string; uploadUrl: string }>("/posts", {
        method: "POST", body: JSON.stringify({ caption, contentType: file.type, size: file.size }),
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

  function onDrag(e: DragEvent, over: boolean) {
    e.preventDefault();
    if (!busy) setDragging(over);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!busy) pick(e.dataTransfer.files?.[0]);
  }

  return (
    <>
      <Nav />
      <main className="feed">
        <form className="card upload" onSubmit={submit}>
          <h1 className="upload-title">New post</h1>

          <label
            className={`dropzone${preview ? " has-preview" : ""}${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
            onDragEnter={(e) => onDrag(e, true)} onDragOver={(e) => onDrag(e, true)}
            onDragLeave={(e) => onDrag(e, false)} onDrop={onDrop}
          >
            <input ref={inputRef} className="sr-only" type="file" accept={TYPES.join(",")}
              onChange={(e) => pick(e.target.files?.[0])} disabled={busy} aria-label="Choose a photo" />
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="preview" src={preview} alt="Selected photo" />
            ) : (
              <span className="dropzone-empty">
                <ImagePlus size={44} strokeWidth={1.3} aria-hidden />
                <span className="dropzone-title"><span className="drag-only">Drag a photo here</span><span className="touch-only">Add a photo</span></span>
                <span className="btn secondary sm" aria-hidden><span className="drag-only">Select from computer</span><span className="touch-only">Choose from library</span></span>
              </span>
            )}
            {busy && (
              <span className="dropzone-busy">
                <Spinner size={28} label={phase === "uploading" ? "Uploading" : "Processing"} className="on-scrim" />
              </span>
            )}
          </label>

          {/* Always rendered (fixed height) so picking a photo doesn't shift the form. */}
          <div className="upload-meta">
            {file ? (
              <>
                <span className="xs muted truncate" title={file.name}>{file.name} · {mb(file.size)}</span>
                <button type="button" className="ghost sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                  <RefreshCw size={14} aria-hidden /> Change
                </button>
              </>
            ) : (
              <span className="xs muted">JPEG or PNG, up to 5 MB</span>
            )}
          </div>

          <label className="caption-field">
            <span className="sr-only">Caption</span>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={CAPTION_MAX} rows={3}
              disabled={busy} placeholder="Write a caption…" />
            <span className={`xs counter${caption.length > CAPTION_MAX - 100 ? " warn" : ""}`} aria-live="polite">
              {caption.length.toLocaleString()}/{CAPTION_MAX.toLocaleString()}
            </span>
          </label>

          <p className="error" role="alert">{error}</p>
          <button type="submit" className="block" disabled={!file || busy}>
            {busy && <Spinner size={16} label="" className="on-accent" />}
            {phase === "uploading" ? "Uploading…" : phase === "processing" ? "Processing…" : "Share"}
          </button>
        </form>
      </main>
    </>
  );
}
