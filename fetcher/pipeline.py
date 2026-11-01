"""Fetch prices for the shops listed in config/fetch.json, one file each."""

import json
from datetime import datetime, timezone
from pathlib import Path

from .adapters import adapter_for
from .adapters.base import Unsupported
from .http import Client, HttpError
from .normalize import dedupe, keep_sane, term_in_name


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json(path, default):
    file = Path(path)
    if not file.exists():
        return default
    return json.loads(file.read_text(encoding='utf-8'))


def merge_store(previous, store, outcome, checked_at):
    """Replace one shop's rows, or keep the previous rows and mark them stale."""
    prev_rows = list((previous or {}).get('products') or [])
    prev_meta = (previous or {}).get('store') or {}
    if outcome['ok']:
        meta = {
            'id': store['id'],
            'name': store.get('name') or '',
            'chain': store.get('chain') or '',
            'status': 'ok',
            'stale': False,
            'error': '',
            'fetched_at': checked_at,
            'checked_at': checked_at,
            'product_count': len(outcome['products']),
            'offer_count': sum(1 for row in outcome['products'] if row.get('offer')),
        }
        return outcome['products'], meta, False
    meta = {
        'id': store['id'],
        'name': store.get('name') or prev_meta.get('name') or '',
        'chain': store.get('chain') or prev_meta.get('chain') or '',
        'status': 'stale',
        'stale': True,
        'error': outcome['error'],
        'fetched_at': prev_meta.get('fetched_at') or '',
        'checked_at': checked_at,
        'product_count': len(prev_rows),
        'offer_count': sum(1 for row in prev_rows if row.get('offer')),
    }
    return prev_rows, meta, True


def fetch_store(source, store, terms, offers_limit, match_limit, fetched_at):
    if not getattr(source, 'prices', True):
        raise Unsupported(f'{source.label} has no public prices.')
    rows = []
    errors = []
    ask = max(match_limit * 4, 12)
    for term in terms:
        try:
            found = source.search(store, term, ask, fetched_at)
            found = [row for row in keep_sane(found) if term_in_name(term, row['name'])]
            rows.extend(found[:match_limit])
        except (HttpError, Unsupported) as exc:
            errors.append(f'{term}: {exc}')
    if getattr(source, 'offers', True):
        try:
            offers = source.offers(store, offers_limit, fetched_at)
            rows.extend(keep_sane(offers)[:offers_limit])
        except (HttpError, Unsupported) as exc:
            errors.append(f'offers: {exc}')
    products = dedupe(rows)
    if not products:
        detail = '; '.join(errors) or 'no priced products came back'
        raise HttpError(detail)
    return {'ok_products': products}


def run_prices(config, index, watchlist, out_dir, client=None):
    terms = [t.strip() for t in (watchlist.get('terms') or []) if str(t).strip()]
    if not terms:
        raise SystemExit('The watchlist is empty.')
    by_id = {row['id']: row for row in (index.get('stores') or [])}
    interval = float(config.get('min_interval_seconds') or 0.45)
    offers_limit = int(config.get('offers_per_store') or 30)
    match_limit = int(config.get('matches_per_term') or 3)
    client = client or Client(min_interval=interval)
    cache = {}
    checked_at = now_iso()
    written = []
    failed = False
    for sid in config.get('store_ids') or []:
        store = by_id.get(sid)
        if not store:
            print(f'{sid}: not in the store directory')
            failed = True
            continue
        try:
            source = adapter_for(store['chain'], client, cache)
        except StopIteration:
            print(f'{store.get("name") or sid}: no adapter')
            failed = True
            continue
        path_store = {
            'id': store['id'],
            'name': store.get('name') or '',
            'chain': store.get('chain') or '',
            'external_id': store.get('external_id') or '',
        }
        if not store.get('prices', True) or not getattr(source, 'prices', True):
            document = {
                'store': {
                    **path_store,
                    'status': 'unsupported',
                    'stale': False,
                    'error': 'No public price feed for this shop.',
                    'fetched_at': '',
                    'checked_at': checked_at,
                    'product_count': 0,
                    'offer_count': 0,
                },
                'products': [],
            }
            path = Path(out_dir) / f'{sid}.json'
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            written.append(sid)
            print(f'{store["name"]}: skipped (no public prices)')
            continue
        previous = load_json(Path(out_dir) / f'{sid}.json', None)
        try:
            products = fetch_store(source, store, terms, offers_limit, match_limit, checked_at)
            rows, meta, bad = merge_store(
                None, path_store,
                {'ok': True, 'products': products['ok_products'], 'error': ''},
                checked_at,
            )
            print(f'{store["name"]}: {meta["product_count"]} products, {meta["offer_count"]} offers')
        except (HttpError, Unsupported, KeyError, TypeError, ValueError) as exc:
            rows, meta, bad = merge_store(
                previous, path_store,
                {'ok': False, 'error': str(exc)},
                checked_at,
            )
            print(f'{store["name"]}: FAILED {exc} (kept {len(rows)} previous rows)')
        document = {'store': meta, 'products': rows}
        path = Path(out_dir) / f'{sid}.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        written.append(sid)
        failed = failed or bad
    return written, failed
