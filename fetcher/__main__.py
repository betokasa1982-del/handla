"""python -m fetcher  — read the watchlist, write data/prices.json.

Exits 1 when a shop that should have prices failed. The file still contains
that shop's last good rows, marked stale, so the app can warn instead of
going blank.
"""

import sys
from pathlib import Path

from .pipeline import empty_document, load_json, run, write_document

ROOT = Path(__file__).resolve().parent.parent


def main():
    config = load_json(ROOT / 'data' / 'stores.json', {})
    watchlist = load_json(ROOT / 'data' / 'watchlist.json', {'terms': []})
    out = ROOT / 'data' / 'prices.json'
    previous = load_json(out, empty_document())
    document, failed = run(config, watchlist, previous)
    write_document(out, document)
    ok = [s['name'] for s in document['stores'] if s['status'] == 'ok']
    bad = [s['name'] for s in document['stores'] if s['status'] == 'stale']
    skipped = [s['name'] for s in document['stores'] if s['status'] == 'unsupported']
    print(f'wrote {out} — ok: {", ".join(ok) or "none"}')
    if skipped:
        print('skipped: ' + ', '.join(skipped))
    if bad:
        print('stale: ' + ', '.join(bad))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
