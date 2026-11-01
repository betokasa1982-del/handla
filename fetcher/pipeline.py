"""Fetch each shop on its own, keep the last good copy when one fails."""

import json
from datetime import datetime, timezone
from pathlib import Path

from .http import Client, HttpError
from .normalize import dedupe, keep_sane, term_in_name
from .sources import SOURCES


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json(path, default):
    file = Path(path)
    if not file.exists():
        return default
    return json.loads(file.read_text(encoding='utf-8'))


def empty_document():
    return {'generated_at': '', 'stores': [], 'products': []}


def merge_store(previous, store, outcome, checked_at):
    """Replace one shop's rows, or keep the previous rows and mark them stale."""
    sid = store['id']
    prev_rows = [row for row in previous.get('products') or [] if row.get('store') == sid]
    prev_meta = next((s for s in previous.get('stores') or [] if s.get('id') == sid), {})
    if outcome['ok']:
        meta = {
            'id': sid,
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
        'id': sid,
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


def unsupported_meta(store, checked_at, reason):
    return {
        'id': store['id'],
        'name': store.get('name') or '',
        'chain': store.get('chain') or '',
        'status': 'unsupported',
        'stale': False,
        'error': reason,
        'fetched_at': '',
        'checked_at': checked_at,
        'product_count': 0,
        'offer_count': 0,
    }


def fetch_store(source, store, terms, offers_limit, match_limit, fetched_at):
    """Search the watchlist and this week's offers. Fail only when nothing priced survives."""
    rows = []
    errors = []
    # Ask for a wider page, then keep only names that actually contain the term.
    ask = max(match_limit * 4, 12)
    for term in terms:
        try:
            found = source.search(store, term, ask, fetched_at)
            found = [row for row in keep_sane(found) if term_in_name(term, row['name'])]
            rows.extend(found[:match_limit])
        except HttpError as exc:
            errors.append(f'{term}: {exc}')
    try:
        offers = source.offers(store, offers_limit, fetched_at)
        rows.extend(keep_sane(offers)[:offers_limit])
    except HttpError as exc:
        errors.append(f'offers: {exc}')
    products = dedupe(rows)
    if not products:
        detail = '; '.join(errors) or 'no priced products came back'
        raise HttpError(detail)
    return {'ok_products': products}


def run(config, watchlist, previous, client=None):
    terms = [t.strip() for t in (watchlist.get('terms') or []) if str(t).strip()]
    if not terms:
        raise SystemExit('The watchlist is empty.')
    interval = float(config.get('min_interval_seconds') or 0.45)
    offers_limit = int(config.get('offers_per_store') or 40)
    match_limit = int(config.get('matches_per_term') or 3)
    client = client or Client(min_interval=interval)
    sources = {}
    checked_at = now_iso()
    products = []
    metas = []
    failed = False
    for store in config.get('stores') or []:
        chain = store.get('chain')
        cls = SOURCES.get(chain)
        label = store.get('name') or store.get('id')
        if cls is None:
            metas.append(unsupported_meta(store, checked_at, f'Unknown chain {chain}.'))
            print(f'{label}: skipped (unknown chain)')
            continue
        if chain not in sources:
            sources[chain] = cls(client)
        source = sources[chain]
        if chain == 'xtra' or not store.get('external_id'):
            reason = 'X:-tra has no public price or offer feed, so it is skipped.'
            metas.append(unsupported_meta(store, checked_at, reason))
            print(f'{label}: skipped ({reason})')
            continue
        try:
            outcome = fetch_store(source, store, terms, offers_limit, match_limit, checked_at)
            rows, meta, bad = merge_store(
                previous, store,
                {'ok': True, 'products': outcome['ok_products'], 'error': ''},
                checked_at,
            )
            print(f'{label}: {meta["product_count"]} products, {meta["offer_count"]} offers')
        except (HttpError, KeyError, TypeError, ValueError) as exc:
            rows, meta, bad = merge_store(
                previous, store,
                {'ok': False, 'products': [], 'error': str(exc)},
                checked_at,
            )
            print(f'{label}: FAILED {exc} (kept {len(rows)} previous rows)')
        products.extend(rows)
        metas.append(meta)
        failed = failed or bad
    document = {
        'generated_at': checked_at,
        'stores': metas,
        'products': products,
    }
    return document, failed


def write_document(path, document):
    text = json.dumps(document, ensure_ascii=False, indent=2) + '\n'
    Path(path).write_text(text, encoding='utf-8')
