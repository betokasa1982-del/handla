# Handla

A shared shopping list with a personal price book, built for the shops around
Bräcke and Eriksberg on Hisingen. Runs as an installable PWA from GitHub Pages.
No server, no database, no monthly bill.

**What it does**

- Collect what ran out at home; items sort themselves into aisles.
- Record the shelf price at each shop, once. It is remembered for next time.
- Compare the whole basket per shop, including kr/kg when you note pack sizes.
- Hand the finished list to a shop for a pickup order.
- Keep two phones on the same list.

---

## 1. Put it on GitHub Pages

1. Create a repository — `handla` is fine. Public or private both work;
   Pages needs a paid plan for private repos, so public is simpler.
2. **Add file → Upload files**, drag in every file from this folder, commit.
3. **Settings → Pages**. Under *Build and deployment*, set Source to
   *Deploy from a branch*, branch `main`, folder `/ (root)`. Save.
4. Wait a minute. The site appears at
   `https://<your-user>.github.io/handla/`.

The repository is public, so **never commit a token into it.** The app keeps
your token in the browser only, and it is never written into the shared list.

## 2. Install it on the phone

Open the Pages URL in Chrome on Android, then **Setup → Add to home screen**
(or the browser menu → Install app). On iPhone, open it in Safari and use
Share → Add to Home Screen.

After the first load it works offline. The list, prices and shops all live on
the device; syncing is what needs a connection.

## 3. Share the list with a second phone

The shared list lives in a **secret Gist** — a private file in your GitHub
account that the app reads and writes. Both phones point at the same one.

**Make a token** (once, on your own account):

1. GitHub → your avatar → **Settings** → **Developer settings** →
   **Personal access tokens** → **Tokens (classic)** → *Generate new token*.
2. Name it `handla`. Set an expiry you are comfortable with.
3. Tick **only** the `gist` scope. Nothing else.
4. Generate, and copy the token — GitHub shows it once.

**Set up the first phone:**

1. Open the app → **Setup**.
2. Paste the token into *Access token*.
3. Tap **Create a new shared list**. The app makes the secret Gist and fills in
   the ID.

**Set up the second phone:**

1. Open the same Pages URL, install it.
2. Paste the **same token** and the **same list ID**.
3. Tick *Keep both phones in sync*.

That is it. Changes sync when either phone is open — every 20 seconds, plus
straight after an edit and whenever the app comes back to the foreground.

### How conflicts are handled

Every item, price and shop carries its own timestamp. Merging happens per item,
not per list, so you can both add things at the same time and nothing is lost.
If you both edit *the same item*, the later edit wins for that item only.
Deleted items leave a tombstone for 30 days so a delete on one phone does not
get resurrected by the other.

### A note on the token

Tokens are shared secrets, so it is worth being deliberate:

- The `gist` scope reaches your gists and nothing else — not your repos, not
  your account settings.
- It is stored in each browser's local storage. Anyone with the unlocked phone
  can read it. That is the same exposure as a saved password.
- If a phone is lost, revoke the token on GitHub and make a new one. The list
  itself is untouched.
- If you would rather not share one token, make a second token from your wife's
  own GitHub account and add her as a collaborator is *not* possible for gists —
  gists have a single owner. One shared token is the simple path.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole app — markup, styles, logic |
| `sw.js` | Service worker: offline shell, network-first for the app |
| `manifest.webmanifest` | Name, colours, icons, standalone display |
| `icon-192.png`, `icon-512.png` | App icons |
| `icon-maskable-512.png` | Android adaptive icon |
| `apple-touch-icon.png` | iOS home screen icon |

## Changing things later

Edit `index.html` in the GitHub web editor and commit — Pages redeploys in about
a minute. If you change any file listed in `SHELL` inside `sw.js`, bump the
`CACHE` constant (`handla-v3` → `handla-v4`) so phones drop the old cache
instead of serving a stale copy.

Store search URLs are editable in **Setup** without touching code. `{q}` is
where the item name goes. If a chain redesigns its site and a *find* link
breaks, fix it there.

## Known limits

- No Swedish grocery chain publishes a price API, so prices are the ones you
  type. The app gets sharper the more trips you log, not automatically.
- No chain exposes an ordering API either. Willys accepts the whole list in one
  paste through its list search; ICA and Coop are item by item. Payment and the
  pickup slot always happen on the shop's own site.
- X:-tra has no online shop at all — it is there for price comparison only.
