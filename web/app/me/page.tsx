"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Nav } from "../../components/Nav";
import { api, ApiError, type Profile } from "../../lib/api";

export default function Me() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined); // undefined = loading, null = none yet
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Profile>("/me")
      .then((p) => { setProfile(p); setUsername(p.username); setBio(p.bio); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setProfile(null);
        else if (!(e instanceof ApiError && e.status === 401)) setError(String(e.message));
      });
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    try {
      const p = await api<Profile>("/me", { method: "PUT", body: JSON.stringify({ username, bio }) });
      setProfile(p);
      setUsername(p.username);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? "That username is taken." : String((err as Error).message));
    }
  }

  return (
    <>
      <Nav />
      <main>
        {profile === undefined && !error && <p className="muted">Loading…</p>}
        {profile && (
          <section className="profile">
            <h1>@{profile.username}</h1>
            <p>{profile.bio || <span className="muted">No bio yet.</span>}</p>
            <p className="counts">
              <span><b>{profile.postCount}</b> posts</span>
              <span><b>{profile.followerCount}</b> followers</span>
              <span><b>{profile.followingCount}</b> following</span>
            </p>
          </section>
        )}
        {profile !== undefined && (
          <form className="card" onSubmit={save}>
            <h2>{profile ? "Edit profile" : "Choose a username"}</h2>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} required pattern="[A-Za-z0-9_]{3,20}"
                title="3-20 letters, numbers or _" />
            </label>
            <label>
              Bio
              <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={150} rows={3} />
            </label>
            <p className="error" role="alert">{error}</p>
            <button type="submit">Save</button>
            {saved && <span className="muted"> Saved</span>}
          </form>
        )}
        {profile === undefined && error && <p className="error">{error}</p>}
      </main>
    </>
  );
}
