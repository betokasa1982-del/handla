"""Read prices from the JSON each chain's own website already calls.

No keys are stored here. Coop's site prints a public subscription key in its
HTML; we read it at run time and forget it.
"""

import re
from urllib.parse import quote

from .http import HttpError
from .normalize import canon_unit, parse_number, record

WILLYS = 'https://www.willys.se'
ICA = 'https://handlaprivatkund.ica.se'
COOP_PAGE = 'https://www.coop.se/'
COOP_SEARCH = 'https://external.api.coop.se/personalization'


def _promo_text(promo):
    parts = [
        promo.get('conditionLabel'),
        promo.get('textLabelGenerated'),
        promo.get('textLabelManual'),
        promo.get('cartLabel'),
    ]
    return ' '.join(p.strip() for p in parts if isinstance(p, str) and p.strip())


def willys_product(raw, store_id, fetched_at, query=''):
    price = parse_number(raw.get('priceValue'))
    if price is None:
        price = parse_number(raw.get('price'))
    if price is None:
        return None
    promos = raw.get('potentialPromotions') or []
    promo = promos[0] if promos else {}
    image = ((raw.get('image') or {}).get('url')) or ((raw.get('thumbnail') or {}).get('url')) or ''
    code = raw.get('code') or ''
    return record(
        store=store_id,
        name=raw.get('name'),
        brand=raw.get('manufacturer'),
        price=price,
        size_text=raw.get('displayVolume') or raw.get('productLine2'),
        compare_price=raw.get('comparePrice'),
        compare_unit=raw.get('comparePriceUnit'),
        offer=bool(promos),
        offer_text=_promo_text(promo) if promo else '',
        valid_until=promo.get('validUntil') if promo else None,
        url=f'{WILLYS}/produkt/{code}' if code else '',
        image=image,
        fetched_at=fetched_at,
        query=query,
    )


def _ica_headers(external_id):
    base = f'{ICA}/stores/{external_id}'
    return {
        'Referer': base,
        'Origin': ICA,
    }


def _ica_compare(block):
    if not isinstance(block, dict):
        return None, ''
    price = (block.get('price') or {}).get('amount')
    unit = block.get('unitName') or block.get('unit') or ''
    return price, canon_unit(unit) or unit


def ica_product(raw, store_id, external_id, fetched_at, query=''):
    promo_price = (raw.get('promoPrice') or {}).get('amount')
    shelf = (raw.get('price') or {}).get('amount')
    price = parse_number(promo_price if promo_price not in (None, '') else shelf)
    if price is None:
        return None
    compare_price, compare_unit = _ica_compare(raw.get('promoUnitPrice') or raw.get('unitPrice'))
    if not compare_unit:
        compare_price, compare_unit = _ica_compare(raw.get('unitPrice'))
    promos = raw.get('promotions') or []
    text = ''
    if promos and isinstance(promos[0], dict):
        text = promos[0].get('description') or ''
    rid = raw.get('retailerProductId') or ''
    image = ((raw.get('image') or {}).get('src')) or ''
    return record(
        store=store_id,
        name=raw.get('name'),
        brand=raw.get('brand'),
        price=price,
        size_text=raw.get('packSizeDescription'),
        compare_price=compare_price,
        compare_unit=compare_unit,
        offer=bool(promos) or promo_price not in (None, ''),
        offer_text=text,
        valid_until=None,
        url=f'{ICA}/stores/{external_id}/products/{rid}' if rid else '',
        image=image,
        fetched_at=fetched_at,
        query=query,
    )


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
    message = promo0.get('message') or ''
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
        offer_text=message,
        valid_until=promo0.get('endDate'),
        url=f'https://www.coop.se/handla/sok/?q={quote(str(ean))}' if ean else '',
        image=raw.get('imageUrl') or '',
        fetched_at=fetched_at,
        query=query,
    )


class Willys:
    chain = 'willys'

    def __init__(self, client):
        self.client = client
        self._active = None

    def _activate(self, external_id):
        if self._active == external_id:
            return
        token = self.client.request(f'{WILLYS}/axfood/rest/csrf-token', accept='*/*')
        if isinstance(token, str):
            token = token.strip().strip('"')
        else:
            token = str(token).strip().strip('"')
        self.client.request(
            f'{WILLYS}/axfood/rest/store/activate?storeId={quote(str(external_id))}'
            '&activelySelected=true&forceAsPickingStore=true',
            method='POST',
            headers={'x-csrf-token': token},
            body={},
        )
        self._active = external_id

    def _rows(self, payload, store_id, fetched_at, query):
        rows = []
        for raw in (payload or {}).get('results') or []:
            row = willys_product(raw, store_id, fetched_at, query)
            if row:
                rows.append(row)
        return rows

    def search(self, store, term, limit, fetched_at):
        self._activate(store['external_id'])
        payload = self.client.request(
            f'{WILLYS}/search?q={quote(term)}&page=0&size={limit}'
        )
        return self._rows(payload, store['id'], fetched_at, term)

    def offers(self, store, limit, fetched_at):
        self._activate(store['external_id'])
        payload = self.client.request(
            f'{WILLYS}/search/campaigns/online?q={quote(str(store["external_id"]))}'
            f'&type=PERSONAL_GENERAL&page=0&size={limit}'
        )
        # Willys Hemma shops often have shelf prices and an empty campaign list.
        # An empty list is a real answer, not a broken feed.
        return self._rows(payload, store['id'], fetched_at, '')


class Ica:
    chain = 'ica'

    def __init__(self, client):
        self.client = client

    def _get(self, store, path):
        ext = store['external_id']
        return self.client.request(
            f'{ICA}/stores/{quote(str(ext))}{path}',
            headers=_ica_headers(ext),
        )

    def _rows(self, payload, store, fetched_at, query):
        rows = []
        for group in (payload or {}).get('productGroups') or []:
            for raw in group.get('decoratedProducts') or []:
                row = ica_product(raw, store['id'], store['external_id'], fetched_at, query)
                if row:
                    rows.append(row)
        return rows

    def search(self, store, term, limit, fetched_at):
        payload = self._get(
            store,
            f'/api/webproductpagews/v6/product-pages/search?q={quote(term)}'
            f'&tag=web&maxPageSize={limit}&maxProductsToDecorate={limit}',
        )
        return self._rows(payload, store, fetched_at, term)

    def offers(self, store, limit, fetched_at):
        payload = self._get(
            store,
            '/api/webproductpagews/v6/product-pages/promotions'
            f'?maxPageSize={limit}&maxProductsToDecorate={limit}',
        )
        return self._rows(payload, store, fetched_at, '')


class Coop:
    chain = 'coop'

    def __init__(self, client):
        self.client = client
        self._key = None

    def _subscription_key(self):
        if self._key:
            return self._key
        html = self.client.request(COOP_PAGE, accept='text/html')
        if not isinstance(html, str):
            html = str(html)
        match = re.search(r'personalizationApiSubscriptionKey"\s*:\s*"([a-f0-9]{32})"', html)
        if not match:
            raise HttpError('Coop did not publish a search key on its front page')
        self._key = match.group(1)
        return self._key

    def _post(self, store, path, body):
        key = self._subscription_key()
        url = (
            f'{COOP_SEARCH}{path}?api-version=v2&store={quote(str(store["external_id"]))}'
            '&groups=CUSTOMER_PRIVATE&device=desktop&direct=false'
        )
        return self.client.request(
            url,
            method='POST',
            headers={'Ocp-Apim-Subscription-Key': key},
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


class Xtra:
    """X:-tra publishes no product or offer JSON. Skip it instead of guessing."""

    chain = 'xtra'

    def __init__(self, client):
        self.client = client

    def search(self, store, term, limit, fetched_at):
        return []

    def offers(self, store, limit, fetched_at):
        return []


SOURCES = {
    'willys': Willys,
    'ica': Ica,
    'coop': Coop,
    'xtra': Xtra,
}
