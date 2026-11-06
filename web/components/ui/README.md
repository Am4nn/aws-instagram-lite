# UI foundation (phase 1)

## Where styles live
- `web/app/globals.css` — tokens, reset, base type, primitives, app shell. Everything there sits in
  `@layer tokens, reset, base, primitives, shell`.
- `web/styles/feed.css` (login + feed), `profile.css` (/me, /u, /new), `post.css` (/p, likes, comments, notifications).
  These are `@import`ed at the top of globals.css and are **unlayered**, so any rule you write there beats the
  primitives regardless of specificity or order. No `!important` needed. Add new rules only to your area file.
- Always use tokens (`var(--…)`), never raw hex. Both themes then work for free.

## Tokens (`:root`)
- Surfaces: `--bg` (page), `--surface` (cards/bars), `--surface-2` (placeholders, sunken), `--hover`, `--press`
- Lines/text: `--border`, `--border-strong`, `--text`, `--muted`
- Accent (calm blue): `--accent` #2f63d1 (dark #3a70e0) for filled buttons, `--accent-hover`, `--accent-text`
  (links; dark #7aa5f5), `--accent-soft` (tinted bg), `--on-accent`, `--focus` (focus ring colour)
- `--like` #ed4956 (heart, unread badge), `--danger` (error text), `--ok`
- Neutral scale `--n-0 … --n-950`; type `--fs-xs 12 / sm 13 / md 15 / lg 17 / xl 22 / 2xl 28`, `--font`
- Radii `--r-sm 6 / md 8 / lg 12 / full`; spacing `--s-1 4 … --s-12 48`; `--shadow-sm`, `--shadow-md`
- Motion `--dur` 160ms (0 under reduced motion), `--ease`
- Layout `--rail-w 72`, `--rail-w-wide 244`, `--header-h 52`, `--tabbar-h 52`, widths `--w-narrow 360`,
  `--w-feed 470`, `--w-default 600`, `--w-wide 935`. Use `<main className="feed|wide|narrow">` to pick a width.
- Legacy aliases still work: `--fg --line --card --err`.
- Dark: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and `:root[data-theme="dark"]`.

## Primitives (classes)
- `button` = primary. Variants: `.secondary`, `.ghost`, `.icon-btn` (36px square, needs `aria-label`),
  `.sm`, `.block`, `button.link` (text button). `.btn` makes a `<Link>`/`<a>` look like a button (combine with variants).
- `input`, `textarea` (40px, focus ring), `label` (stacked, muted). `.card`, `.error` (reserves 20px),
  `.muted`, `.small`, `.xs`, `.sr-only`, `.badge` (`.neutral`, `.dot`), `.divider`, `.skeleton`, `.skeleton-text`,
  `.spinner`, `.empty-state`, `.avatar`.

## Components (`web/components/ui/`)
- `<Avatar name="bob" size="sm|md|lg|xl" />` — initials, stable muted hue. 24 / 32 / 56 / 150px (xl is 84px on phones).
- `<EmptyState icon={Camera} title="No posts yet" hint="optional" action={<Link className="btn" href="/new">Share a photo</Link>} />`
- `<Skeleton w={..} h={..} r={..} circle ratio="1 / 1" />`, `<SkeletonText lines={2} />` — size it like the real content.
- `<Spinner size={18} label="Loading" />`
- `<ThemeToggle />` — cycles system → light → dark (already in the Nav).
- `web/lib/time.ts`: `timeAgo(iso)` → "now" / "5m" / "2h" / "3d" / "Nov 2"; `fullDate(iso)` for a `title` tooltip.
- `web/lib/theme.ts`: `getTheme()`, `setTheme('light'|'dark'|'system')`, `resolvedTheme()`.
- Icons: `lucide-react` (`import { Heart } from "lucide-react"`), default stroke 1.8-2, size 20-24.

## Shell
`<Nav />` (or `<Nav unread={0} />`) goes before `<main>` as before. ≥768px: left icon rail (labels ≥1200px).
<768px: top header (brand, activity, theme, log out) + bottom tabs (home, new, profile).
`body:has(.app-nav)` pads the page, so don't add your own offsets for the bars.

## Screenshots
`npx tsx scripts/src/shots.ts [route...] [--light|--dark] [--desktop|--phone] [--full]`
(`post` = first post from the feed). Files: scratchpad `shots/<slug>-<width>-<theme>.png`.
