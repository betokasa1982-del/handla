"""Willys and Hemköp. Same Axfood JSON, two hosts.

Prices are per shop. An anonymous session is pinned with
POST /axfood/rest/store/activate before search or campaigns.
"""

import re
from urllib.parse import quote

from ..normalize import parse_number, record
from .base import ChainAdapter, directory_record

_SIZE_IN_LINE = re.compile(r'(\d+(?:[.,]\d+)?\s*(?:kg|g|l|dl|cl|ml|st))\b', re.I)


def _promo_text(promo):
    parts = [
        promo.get('conditionLabel'),
        promo.get('textLabelGenerated'),
        promo.get('textLabelManual'),
    ]
    return ' '.join(p.strip() for p in parts if isinstance(p, str) and p.strip())


def willys_product(raw, store_id, fetched_at, query='', host='https://www.willys.se'):
    """Kept name: tests and Hemköp share this shape. `store_id` is the app id."""
    return axfood_product(raw, store_id, fetched_at, query, host)


def axfood_product(raw, store_id, fetched_at, query, host):
    price = parse_number(raw.get('priceValue'))
    if price is None:
        price = parse_number(raw.get('price'))
    if price is None:
        return None
    promos = raw.get('potentialPromotions') or []
    promo = promos[0] if promos else {}
    image = ((raw.get('image') or {}).get('url')) or ((raw.get('thumbnail') or {}).get('url')) or ''
    code = raw.get('code') or ''
    size = raw.get('displayVolume') or ''
    if not size:
        match = _SIZE_IN_LINE.search(raw.get('productLine2') or '')
        size = match.group(1) if match else ''
    return record(
        store=store_id,
        name=raw.get('name'),
        brand=raw.get('manufacturer'),
        price=price,
        size_text=size,
        compare_price=raw.get('comparePrice'),
        compare_unit=raw.get('comparePriceUnit'),
        offer=bool(promos),
        offer_text=_promo_text(promo) if promo else '',
        valid_until=promo.get('validUntil') if promo else None,
        url=f'{host}/produkt/{code}' if code else '',
        image=image,
        fetched_at=fetched_at,
        query=query,
    )


class AxfoodAdapter(ChainAdapter):
    host = ''
    chain = ''
    label = ''

    def __init__(self, client):
        super().__init__(client)
        self._active = None
        self._warm = False

    def _headers(self):
        # Axfood's CDN answers 403 to a bare bot User-Agent from some networks
        # (GitHub-hosted runners among them). The name and the repo URL stay in
        # the header so the call is still identifiable.
        return {
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 '
                'HandlaPriceBot/1.0 (+https://github.com/betokasa1982-del/handla)'
            ),
            'Referer': self.host + '/',
            'Origin': self.host,
        }

    def _warm_session(self):
        if self._warm:
            return
        self.client.request(self.host + '/', accept='text/html', headers=self._headers())
        self._warm = True

    def _activate(self, external_id):
        if self._active == str(external_id):
            return
        self._warm_session()
        token = self.client.request(
            f'{self.host}/axfood/rest/csrf-token', accept='*/*', headers=self._headers()
        )
        token = str(token).strip().strip('"')
        headers = self._headers()
        headers['x-csrf-token'] = token
        self.client.request(
            f'{self.host}/axfood/rest/store/activate?storeId={quote(str(external_id))}'
            '&activelySelected=true&forceAsPickingStore=true',
            method='POST',
            headers=headers,
            body={},
        )
        self._active = str(external_id)

    def list_stores(self):
        self._warm_session()
        payload = self.client.request(
            f'{self.host}/axfood/rest/store?online=false&clickAndCollect=false&b2bClickAndCollect=false',
            headers=self._headers(),
        )
        rows = []
        for raw in payload or []:
            address = raw.get('address') or {}
            geo = raw.get('geoPoint') or {}
            line = address.get('line1') or ''
            postcode = address.get('postalCode') or ''
            city = address.get('town') or ''
            pretty = ', '.join(p for p in (line, f'{postcode} {city}'.strip()) if p)
            sid = raw.get('storeId')
            if not sid or not raw.get('name'):
                continue
            rows.append(directory_record(
                self.chain, sid, raw.get('name'), pretty, postcode, city,
                geo.get('latitude'), geo.get('longitude'),
                home=f'{self.host}/butik/{sid}',
                prices=True, offers=True,
            ))
        return rows

    def _rows(self, payload, store_id, fetched_at, query):
        rows = []
        for raw in (payload or {}).get('results') or []:
            row = axfood_product(raw, store_id, fetched_at, query, self.host)
            if row:
                rows.append(row)
        return rows

    def search(self, store, term, limit, fetched_at):
        self._activate(store['external_id'])
        payload = self.client.request(
            f'{self.host}/search?q={quote(term)}&page=0&size={limit}',
            headers=self._headers(),
        )
        return self._rows(payload, store['id'], fetched_at, term)

    def offers(self, store, limit, fetched_at):
        self._activate(store['external_id'])
        # Empty is a real answer for some Willys Hemma shops.
        payload = self.client.request(
            f'{self.host}/search/campaigns/online?q={quote(str(store["external_id"]))}'
            f'&type=PERSONAL_GENERAL&page=0&size={limit}',
            headers=self._headers(),
        )
        return self._rows(payload, store['id'], fetched_at, '')


class Willys(AxfoodAdapter):
    chain = 'willys'
    label = 'Willys'
    host = 'https://www.willys.se'


class Hemkop(AxfoodAdapter):
    chain = 'hemkop'
    label = 'Hemköp'
    host = 'https://www.hemkop.se'
