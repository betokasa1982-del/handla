"""python -m fetcher directory|prices|all

`directory` refreshes every shop we can locate.
`prices` fetches offers and watchlist prices for config/fetch.json.
`all` does both. Exit code 1 means a shop that should have prices failed,
or the directory came back empty for a chain. The last good rows are kept.
"""

import sys
from pathlib import Path

from .directory import build_directory
from .http import Client
from .pipeline import load_json, run_prices

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / 'data' / 'stores_index.json'
STORE_DIR = ROOT / 'data' / 'stores'
CONFIG = ROOT / 'config' / 'fetch.json'
WATCHLIST = ROOT / 'data' / 'watchlist.json'


def main(argv):
    command = argv[1] if len(argv) > 1 else 'all'
    if command not in ('directory', 'prices', 'all'):
        print('Use: python -m fetcher directory|prices|all')
        return 2
    failed = False
    if command in ('directory', 'all'):
        document, errors = build_directory(Client(min_interval=0.2))
        if errors and document['stores'] and INDEX.exists():
            previous = load_json(INDEX, {'stores': []})
            if len(document['stores']) < 0.5 * len(previous.get('stores') or []):
                print('Directory shrunk too far; leaving the previous file in place.')
                return 1
        INDEX.parent.mkdir(parents=True, exist_ok=True)
        INDEX.write_text(
            __import__('json').dumps(document, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8',
        )
        print(f'wrote {INDEX} ({len(document["stores"])} shops)')
        if errors:
            print('directory problems: ' + '; '.join(errors))
            failed = True
    if command in ('prices', 'all'):
        index = load_json(INDEX, {'stores': []})
        config = load_json(CONFIG, {'store_ids': []})
        watchlist = load_json(WATCHLIST, {'terms': []})
        _written, price_failed = run_prices(config, index, watchlist, STORE_DIR)
        failed = failed or price_failed
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
