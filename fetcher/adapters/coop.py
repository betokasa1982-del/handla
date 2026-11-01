"""Coop prices, plus the X:-tra shops that live in Coop's store register.

X:-tra has coordinates and a name, and no product JSON. The adapter records
the shops and refuses price calls.
"""

import re
from urllib.parse import quote

from ..normalize import parse_number, record
from .base import ChainAdapter, Unsupported, directory_record

COOP_PAGE = 'https://www.coop.se/'
COOP_SEARCH = 'https://external.api.coop.se/personalization'
COOP_STORES = 'https://proxy.api.coop.se/external/store/stores'
_family_cache = {'rows': None}


def coop_product(raw, store_id, fetched_at, query=''):
    sales = (raw.get('salesPriceData') or {}).get('b2cPrice')
    promo = (raw.get('promotionPriceData') or {}).get('b2cPrice')
    price = parse_number(promo if promo not in (None, '') else sales)
    if price is None:
        price = parse_number(sales)
    if price is None:
        return None
    compare = (raw.get('comparativePriceData') or {}).get('b2cPrice')
    unit = ((raw.get('comparativePriceUnit') or {}).get('unit')) or ''
    promos = raw.get('onlinePromotions') or []
    promo0 = promos[0] if promos and isinstance(promos[0], dict) else {}
    ean = raw.get('ean') or raw.get('id') or ''
    return record(
        store=store_id,
        name=raw.get('name'),
        brand=raw.get('manufacturerName'),
        price=price,
        size_text=raw.get('packageSizeInformation'),
        compare_price=compare,
        compare_unit=unit,
        offer=bool(promos) or promo not in (None, ''),
        offer_text=promo0.get('message') or '',
        valid_until=promo0.get('endDate'),
        url=f'https://www.coop.se/handla/sok/?q={quote(str(ean))}' if ean else '',
        image=raw.get('imageUrl') or '',
        fetched_at=fetched_at,
        query=query,
    )


def _is_xtra(name, concept):
    blob = f'{name} {concept}'.casefold().replace(' ', '')
    return 'x:-tra' in blob or 'x-tra' in blob or blob.startswith('xtra') or 'x:tra' in blob


def _key_from_homepage(client, field):
    html = client.request(COOP_PAGE, accept='text/html')
    if not isinstance(html, str):
        html = str(html)
    match = re.search(rf'{field}"\s*:\s*"([a-f0-9]{{32}})"', html)
    if not match:
        raise Unsupported(f'Coop did not publish {field} on its front page')
    return match.group(1)


def load_family(client):
    """Every Coop and X:-tra shop, with coordinates. Cached for the process."""
    if _family_cache['rows'] is not None:
        return _family_cache['rows']
    store_key = _key_from_homepage(client, 'storeApiSubscriptionKey')
    listing = client.request(
        f'{COOP_STORES}?api-version=v2',
        headers={'Ocp-Apim-Subscription-Key': store_key},
    )
    thin = listing.get('stores') or []
    rows = []
    for index, raw in enumerate(thin, start=1):
        ledger = str(raw.get('ledgerAccountNumber') or '').strip()
        if not ledger:
            continue
        try:
            detail = client.request(
                f'{COOP_STORES}/{ledger}?api-version=v2',
                headers={'Ocp-Apim-Subscription-Key': store_key},
            )
        except Exception:
            continue
        name = detail.get('name') or raw.get('name') or ''
        concept = ((detail.get('concept') or {}).get('name')) or ''
        chain = 'xtra' if _is_xtra(name, concept) else 'coop'
        address = ', '.join(p for p in (
            detail.get('streetAddress') or '',
            ' '.join(p for p in (str(detail.get('postalCode') or ''), detail.get('city') or '') if p),
        ) if p)
        home = detail.get('url') or ''
        if home and home.startswith('/'):
            home = 'https://www.coop.se' + home
        rows.append(directory_record(
            chain, ledger, name, address, detail.get('postalCode'), detail.get('city'),
            detail.get('latitude'), detail.get('longitude'),
            home=home,
            prices=(chain == 'coop'),
            offers=(chain == 'coop'),
        ))
        if index % 100 == 0:
            print(f'  coop/x-tra details {index}/{len(thin)}')
    _family_cache['rows'] = rows
    return rows


class Coop(ChainAdapter):
    chain = 'coop'
    label = 'Coop'
    _search_key = None

    def list_stores(self):
        return [row for row in load_family(self.client) if row['chain'] == 'coop']

    def _search_key_value(self):
        if self._search_key:
            return self._search_key
        self._search_key = _key_from_homepage(self.client, 'personalizationApiSubscriptionKey')
        return self._search_key

    def _post(self, store, path, body):
        url = (
            f'{COOP_SEARCH}{path}?api-version=v2&store={quote(str(store["external_id"]))}'
            '&groups=CUSTOMER_PRIVATE&device=desktop&direct=false'
        )
        return self.client.request(
            url, method='POST',
            headers={'Ocp-Apim-Subscription-Key': self._search_key_value()},
            body=body,
        )

    def _rows(self, payload, store_id, fetched_at, query):
        items = ((payload or {}).get('results') or {}).get('items') or []
        rows = []
        for raw in items:
            if raw.get('type') not in (None, '', 'Product'):
                continue
            row = coop_product(raw, store_id, fetched_at, query)
            if row:
                rows.append(row)
        return rows

    def search(self, store, term, limit, fetched_at):
        payload = self._post(store, '/search/products', {
            'query': term,
            'resultsOptions': {'skip': 0, 'take': limit, 'sortBy': [], 'facets': []},
        })
        return self._rows(payload, store['id'], fetched_at, term)

    def offers(self, store, limit, fetched_at):
        payload = self._post(store, '/search/products/promotions', {
            'resultsOptions': {'skip': 0, 'take': limit, 'sortBy': [], 'facets': []},
        })
        return self._rows(payload, store['id'], fetched_at, '')


class Xtra(ChainAdapter):
    chain = 'xtra'
    label = 'X:-tra'
    prices = False
    offers = False

    def list_stores(self):
        return [row for row in load_family(self.client) if row['chain'] == 'xtra']

    def search(self, store, term, limit, fetched_at):
        raise Unsupported('X:-tra has no public product prices.')

    def offers(self, store, limit, fetched_at):
        raise Unsupported('X:-tra has no public offer feed.')


class Lidl(ChainAdapter):
    """Placeholder. Lidl.se did not expose a stable public product JSON."""

    chain = 'lidl'
    label = 'Lidl'
    prices = False
    offers = False
    enabled = False

    def list_stores(self):
        return []

    def search(self, store, term, limit, fetched_at):
        raise Unsupported('Lidl is not wired up yet.')

    def offers(self, store, limit, fetched_at):
        raise Unsupported('Lidl is not wired up yet.')


class CityGross(ChainAdapter):
    """Placeholder. City Gross has a JSON API; it is not fetched in this first cut."""

    chain = 'citygross'
    label = 'City Gross'
    prices = False
    offers = False
    enabled = False

    def list_stores(self):
        return []

    def search(self, store, term, limit, fetched_at):
        raise Unsupported('City Gross is not wired up yet.')

    def offers(self, store, limit, fetched_at):
        raise Unsupported('City Gross is not wired up yet.')
