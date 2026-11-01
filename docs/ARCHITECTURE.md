# How Handla can grow

This is a design note, not a build plan with dates. The app today is a
single HTML file on GitHub Pages. Prices are filled in by GitHub Actions.
That is enough for one person and a handful of shops. It will not carry a
product used by people all over Sweden at once.

## What is here now

Each grocery chain is a Python adapter in `fetcher/adapters/`. An adapter
can do three things:

1. List shops (id, name, address, postcode, city, latitude, longitude).
2. Read this week's offers for one shop.
3. Search the price of a product at one shop.

Willys and Hemköp share one Axfood adapter with two website addresses.
ICA and Coop have their own. X:-tra shops are listed from Coop's store
register, and the adapter refuses price calls because X:-tra does not
publish any. Lidl and City Gross are named in the same list with
`enabled = False`, so a later change is a new class rather than a new
shape of program.

The weekly **Directory** action writes `data/stores_index.json` for the
shops those adapters can see. The nightly **Prices** action only fetches
the ids in `config/fetch.json`, and writes `data/stores/<chain>-<id>.json`.
The phone downloads the directory when you search, and only the price
files for the shops you follow.

Eriksberg is the example set of shops on a first open. It is not special
in the code. Setup → Your area takes a postcode, a place name, or the
phone's location, and you tick the shops you want.

A price you type still replaces the automatic one.

## Why this cannot be "every shop, every night" on GitHub Pages

Sweden has on the order of a couple of thousand shops across these chains.
Fetching a watchlist and a page of offers for each of them, politely, is
hours of requests and a large git commit every night. GitHub Actions and a
static site are a poor place for that, and the chains' sites will not
appreciate it.

The static files are a sample: the example shops, plus a couple more in
Göteborg so a different neighbourhood can be tried. Adding a shop is
putting its id in `config/fetch.json`. That stays viable while the list
is short.

## A hosted backend later

The adapters do not know they are running inside GitHub Actions. A small
HTTP service can call the same classes.

A reasonable shape:

- **API.** A short Python service (FastAPI is a natural fit) with
  `GET /stores?lat=&lon=` or `?q=` for the directory, and
  `GET /stores/{id}/prices` for one shop's current rows.
- **Database.** SQLite is enough for a first server. Postgres is the
  step up when more than one machine writes. Tables: shops, price rows,
  and later users and which shops each user follows.
- **Worker.** One process walks the adapters on a schedule. It fetches a
  shop when someone follows it, keeps the result for a day, and does not
  precompute the whole country. A failed shop keeps the previous rows and
  is marked stale, the same rule as today.
- **Accounts.** The shopping list can stay in the browser at first. When
  people share a list across phones without a private gist, the list and
  the chosen shops move into the database behind a login.
- **Where it runs.** Fly.io, Render, or Cloud Run can each host the API
  and the worker. The Pages site then calls that API instead of reading
  static JSON. The service worker would cache those responses the same
  way it caches `data/stores/` today.

Nothing in that move requires rewriting the chain adapters.

## Terms of use — read this before selling Handla

This is not legal advice. It is a list of what showed up while building
the fetcher, so you can decide, or ask a lawyer, before taking money for
the product.

The prices and offers are read from the JSON endpoints the chains' own
websites call. Those sites are written for shoppers, not for another
company to republish. Commercial use, and automated collection, often
conflict with a website's terms even when the pages are public. Shipping
Handla as a paid product that depends on this data is the point to stop
and check.

What looks safer, if you want a commercial launch:

- **A contract with the chain.** Coop has a developer portal
  (`portal.api.coop.se`) that is aimed at partners, not at anonymous
  scraping. Axfood (Willys, Hemköp) and ICA did not expose an open price
  licence during this work. Asking them for a partner or affiliate feed
  is the clean version of what the adapters do informally.
- **A licensed price-data vendor.** Companies already sell Swedish
  grocery prices under a contract (one public example is Primat). A
  licence is a clearer basis than reading the shop sites yourself. This
  is not a recommendation of any vendor.
- **What you collect yourself.** Prices a user types in stay yours to
  store. That part does not depend on the chains' websites.

What each chain looked like here:

| Chain | What we call | Price feed? | Note |
|---|---|---|---|
| Willys | Axfood JSON on willys.se | Yes, per shop | No public partner price API found. |
| Hemköp | The same Axfood JSON on hemkop.se | Yes, per shop | Same situation as Willys. |
| ICA | ica.se store search, and handlaprivatkund.ica.se product JSON | Yes, per shop | An older unofficial ICA account API is no longer the one their site uses. |
| Coop | Store register and personalization search on coop.se | Yes, per shop | The key in the web page is public but it is still their site. Their partner portal is the formal route. |
| X:-tra | Listed in Coop's store register | No prices | Shops can be shown. Prices cannot. |
| Lidl, City Gross | Not fetched | Not wired | Left as plugins on purpose. |

Until there is a licence or a written ok from the chains, treat the
automatic prices as a personal prototype, not as the data backend of a
paid national product.
