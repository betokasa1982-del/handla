"""Build data/stores_index.json — every shop we can locate in Sweden."""

from .adapters import enabled_adapters
from .http import Client
from .pipeline import now_iso


def build_directory(client=None):
    client = client or Client(min_interval=0.2, retries=3)
    stores = []
    seen = set()
    errors = []
    for adapter in enabled_adapters(client):
        try:
            rows = adapter.list_stores() or []
        except Exception as exc:
            errors.append(f'{adapter.label}: {exc}')
            print(f'{adapter.label}: FAILED {exc}')
            continue
        added = 0
        for row in rows:
            if not row.get('id') or not row.get('name') or row['id'] in seen:
                continue
            if row.get('lat') is None or row.get('lon') is None:
                continue
            seen.add(row['id'])
            stores.append(row)
            added += 1
        print(f'{adapter.label}: {added} shops')
        if added == 0:
            errors.append(f'{adapter.label}: no shops with coordinates')
    stores.sort(key=lambda s: (s['chain'], s['name']))
    document = {'generated_at': now_iso(), 'stores': stores}
    return document, errors
