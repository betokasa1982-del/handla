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
`CACHE` constant (`handla-v6` → `handla-v7`) so phones drop the old cache
instead of serving a stale copy.

Store search URLs are editable in **Setup** without touching code. `{q}` is
where the item name goes. If a chain redesigns its site and a *find* link
breaks, fix it there.

## Automatic prices

The app is not tied to one neighbourhood. Setup → **Your area** takes a
postcode or a place name (Kortedala, Malmö, 415 10) or this phone's location,
then lists Willys, Hemköp, ICA, Coop and X:-tra shops nearby. Tick the ones
you follow. The list you first see is only an example: shops around Eriksberg
in Göteborg.

A nightly GitHub Action reads the JSON those chains already use and writes one
file per shop, `data/stores/<chain>-<id>.json`. The phone only downloads the
shops you follow. A weekly Action refreshes `data/stores_index.json`, the
directory of shops in Sweden. No tokens and no API keys are stored in the repo.

The price job runs at 02:00 UTC (03:00 Stockholm time in winter, 04:00 in
summer). The directory runs on Sunday at 03:00 UTC. Both can be started by
hand from the Actions tab. GitHub only runs the schedule from `main`, so the
price files in this repo are what the site shows until the next night.

The screens are in Portuguese, Swedish, English and Italian. The first open
follows the phone language, and otherwise Portuguese. Setup can change it.

You can type an item in Portuguese, Italian, English or Swedish. The list keeps
that word. A Swedish word is stored under it and used to find prices
(`leite` becomes `mjölk`). Setup → **Language of item names** is Auto unless
you pick one. Words the built-in list does not know are sent to the free
MyMemory translator when you are online, and remembered on the phone. If that
fails, edit the Swedish word on the row. Details are in the section below.

A price you type still wins. An automatic price only fills an empty box, as
the grey hint, and the basket math uses it. Where the units differ it compares
the jämförpris (kr per kilo or litre). Items on offer are marked **offer**.
Under the list, each shop says when its file was updated, and **(stale)** if
that copy is old or the last fetch failed.

The nightly job prices the shops in `config/fetch.json` (the Eriksberg example
plus Willys Wieselgrensplatsen and Hemköp Kortedala Torg). Add an id from the
directory to that list and the next run will price it. Search words live in
`data/watchlist.json`.

X:-tra shops are in the directory so you can follow them, but they have no
public prices. The job records that and does not fail.

### When a shop breaks

Each shop is fetched on its own. Requests are one at a time, with a named
User-Agent, a short pause, and a few retries. If a shop returns nothing, or
the prices are nonsense, that file keeps its previous rows, marks them stale,
and the Action fails so GitHub can email you. The other shops are still updated.

Coop prints a public subscription key in its own web page. The job reads it
when it runs and does not save it.

How the pieces fit together, and the terms-of-service risk of selling this,
is in `docs/ARCHITECTURE.md`. The normalizer is covered by
`python3 -m unittest tests.test_prices.py`.

## Known limits

- No chain exposes an ordering API. Willys accepts the whole list in one
  paste through its list search; ICA and Coop are item by item. Payment and the
  pickup slot always happen on the shop's own site.
- X:-tra has no online shop and no price feed. It stays in the app for the
  trips you price by hand.
- Automatic prices are pack prices from the shop's site, not a promise that
  the shelf in front of you matches to the öre. A price you typed is kept.
