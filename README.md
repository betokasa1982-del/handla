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
`CACHE` constant (`handla-v5` → `handla-v6`) so phones drop the old cache
instead of serving a stale copy.

Store search URLs are editable in **Setup** without touching code. `{q}` is
where the item name goes. If a chain redesigns its site and a *find* link
breaks, fix it there.

## Automatic prices

The shops do not offer a public price API. A small Python job in GitHub Actions
reads the same JSON their own websites use, once a night, and commits
`data/prices.json`. The app loads that file when it opens. No tokens and no API
keys are stored in the repo.

It runs at 02:00 UTC, which is 03:00 in Stockholm in the winter and 04:00 in the
summer. You can also run it by hand: Actions → Prices → Run workflow.

What it collects, for each shop in `data/stores.json`:

- this week's offers, when the shop publishes them
- current prices for the search terms in `data/watchlist.json`

A price you type yourself still wins. An automatic price only fills in when
that box is empty. It shows up as the grey placeholder in the price field, and
the basket math uses it. If the same item is on offer at any shop, the row is
marked **offer**. Under the list, each shop says when its prices were last
updated, and **(stale)** if the last good copy is more than a day and a half
old or the latest fetch failed.

The shops near Eriksberg that this is set up for:

| Shop in the app | Where the prices come from |
|---|---|
| Willys Hemma Vårväderstorget | Willys store `2816`. Shelf prices work. This Willys Hemma shop does not publish a digital campaign list, so weekly offers are usually empty. The nearest full Willys with offers is Wieselgrensplatsen, store `2102` — change `external_id` if you would rather follow that shop. |
| ICA Kvantum Sannegården | ICA online store `1004293`. |
| Coop Eriksberg | Coop store `126350`. Prices here differ from other Coop shops. |
| X:-tra Länsmanstorget | No public price feed. The job skips it and says so. It does not fail the run. |

### Change a shop or the watchlist

Edit `data/stores.json` or `data/watchlist.json` and commit. The next run picks
it up. `id` must stay the same as the shop id in the app (`willys-varvader`,
`ica-sannegarden`, `coop-eriksberg`, `xtra-hisingen`) or the prices will not
line up with your list.

### When a shop breaks

Each shop is fetched on its own. If one returns nothing, or the prices are
nonsense, that shop keeps its previous rows, the file marks it stale, and the
Action fails so GitHub can email you. The other shops are still updated.

The job is polite on purpose: one request at a time, a named User-Agent, and a
short pause between calls. It retries a few times if a site answers with a
temporary error. Coop's website prints a public subscription key in the page
itself; the job reads that key when it runs and does not save it.

If Willys, ICA or Coop change their site and the job starts failing every
night, the thing to edit is `fetcher/sources.py`. The normalizer and the
"keep the last good copy" rule are covered by `python3 -m unittest tests.test_prices.py`.

## Known limits

- No chain exposes an ordering API. Willys accepts the whole list in one
  paste through its list search; ICA and Coop are item by item. Payment and the
  pickup slot always happen on the shop's own site.
- X:-tra has no online shop and no price feed. It stays in the app for the
  trips you price by hand.
- Automatic prices are pack prices from the shop's site, not a promise that
  the shelf in front of you matches to the öre. A price you typed is kept.
