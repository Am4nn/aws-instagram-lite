"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { UserRound } from "lucide-react";
import { Nav } from "../../components/Nav";
import { api, ApiError, type Profile } from "../../lib/api";
import { PostGrid } from "../../components/PostGrid";
import { ProfileHeader, ProfileHeaderSkeleton, ProfileTabs } from "../../components/profile/ProfileHeader";
import { Avatar } from "../../components/ui/Avatar";
import { Spinner } from "../../components/ui/Spinner";

const BIO_MAX = 150;

export default function Me() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined); // undefined = loading, null = none yet
  const [loadError, setLoadError] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoadError("");
    api<Profile>("/me")
      .then((p) => { setProfile(p); setUsername(p.username); setBio(p.bio); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setProfile(null);
        else if (!(e instanceof ApiError && e.status === 401)) setLoadError(String(e.message));
      });
  }, []);
  useEffect(load, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const p = await api<Profile>("/me", { method: "PUT", body: JSON.stringify({ username, bio }) });
      setProfile(p);
      setUsername(p.username);
      setBio(p.bio);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? "That username is taken." : String((err as Error).message));
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    if (!profile) return;
    setUsername(profile.username);
    setBio(profile.bio);
    setError("");
    setEditing(false);
  }

  const usernameInput = (
    <input value={username} onChange={(e) => setUsername(e.target.value)} required pattern="[A-Za-z0-9_]{3,20}"
      title="3-20 letters, numbers or _" autoComplete="off" autoCapitalize="none" spellCheck={false}
      placeholder="username" aria-label="Username" autoFocus={profile === null} />
  );

  return (
    <>
      <Nav />
      <main className={profile === null ? "narrow" : "wide"}>
        {profile === undefined && !loadError && (
          <section className="profile">
            <ProfileHeaderSkeleton />
            <ProfileTabs />
            <div className="grid" aria-hidden>{Array.from({ length: 6 }, (_, i) => <span key={i} className="tile skeleton" />)}</div>
          </section>
        )}

        {profile === undefined && loadError && (
          <div className="grid-msg" role="alert">
            <p className="error">{loadError}</p>
            <button type="button" className="secondary sm" onClick={load}>Retry</button>
          </div>
        )}

        {/* First run: pick a username */}
        {profile === null && (
          <form className="card onboard" onSubmit={save}>
            {username ? <Avatar name={username} size="lg" /> : (
              <span className="avatar avatar-lg onboard-avatar" aria-hidden><UserRound size={26} strokeWidth={1.6} /></span>
            )}
            <h2>Choose a username</h2>
            <p className="muted small onboard-hint">You can change it later.</p>
            <span className="at-field">
              <span aria-hidden>@</span>
              {usernameInput}
            </span>
            <p className="error" role="alert">{error}</p>
            <button type="submit" className="block" disabled={saving}>
              {saving ? <Spinner size={16} label="Saving" className="on-accent" /> : "Continue"}
            </button>
          </form>
        )}

        {profile && (
          <section className="profile">
            <ProfileHeader
              profile={profile}
              action={
                <button type="button" className="secondary" aria-expanded={editing} aria-controls="edit-profile"
                  onClick={() => (editing ? cancelEdit() : setEditing(true))}>
                  Edit profile
                </button>
              }
            />

            {editing && (
              <form id="edit-profile" className="card edit-card" onSubmit={save}>
                <h2>Edit profile</h2>
                <label>
                  Username
                  <span className="at-field">
                    <span aria-hidden>@</span>
                    {usernameInput}
                  </span>
                </label>
                <label>
                  <span className="label-row">Bio <span className="xs counter">{bio.length}/{BIO_MAX}</span></span>
                  <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={BIO_MAX} rows={3}
                    placeholder="Say something about yourself" />
                </label>
                <div className="edit-actions">
                  <p className="error" role="alert">{error}</p>
                  <button type="button" className="ghost" onClick={cancelEdit} disabled={saving}>Cancel</button>
                  <button type="submit" disabled={saving}>
                    {saving ? <Spinner size={16} label="Saving" className="on-accent" /> : "Save"}
                  </button>
                </div>
              </form>
            )}

            <ProfileTabs />
            <PostGrid userId={profile.userId} username={profile.username} count={profile.postCount} isMe />
          </section>
        )}
      </main>
    </>
  );
}
