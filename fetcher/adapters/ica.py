"""ICA store directory and per-store prices from handlaprivatkund.ica.se."""

import re
from urllib.parse import quote

from ..normalize import parse_number, record
from .base import ChainAdapter, directory_record

ICA_SITE = 'https://www.ica.se'
ICA_SHOP = 'https://handlaprivatkund.ica.se'
_ONLINE_ID = re.compile(r'(\d{5,7})/?$')


def _compare(block):
    if not isinstance(block, dict):
        return None, ''
    price = (block.get('price') or {}).get('amount')
    unit = block.get('unitName') or block.get('unit') or ''
    return price, unit


def ica_product(raw, store_id, external_id, fetched_at, query=''):
    promo_price = (raw.get('promoPrice') or {}).get('amount')
    shelf = (raw.get('price') or {}).get('amount')
    price = parse_number(promo_price if promo_price not in (None, '') else shelf)
    if price is None:
        return None
    compare_price, compare_unit = _compare(raw.get('promoUnitPrice') or raw.get('unitPrice'))
    promos = raw.get('promotions') or []
    text = promos[0].get('description') if promos and isinstance(promos[0], dict) else ''
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
        offer_text=text or '',
        valid_until=None,
        url=f'{ICA_SHOP}/stores/{external_id}/products/{rid}' if rid else '',
        image=image,
        fetched_at=fetched_at,
        query=query,
    )


class Ica(ChainAdapter):
    chain = 'ica'
    label = 'ICA'

    def list_stores(self):
        skip = 0
        take = 100
        docs = []
        total = None
        while True:
            payload = self.client.request(
                f'{ICA_SITE}/api/store/search?take={take}&skip={skip}'
            )
            page = payload.get('Documents') or []
            total = (payload.get('Stats') or {}).get('TotalHits') or total
            docs.extend(page)
            if not page:
                break
            skip += len(page)
            if total is not None and skip >= total:
                break
            if skip > 5000:
                break
        rows = []
        for raw in docs:
            url = raw.get('Url') or ''
            match = _ONLINE_ID.search(url)
            ext = match.group(1) if match else str(raw.get('Id') or '')
            if not ext or not raw.get('Name'):
                continue
            address = ', '.join(p for p in (
                raw.get('VisitingAddress') or '',
                ' '.join(p for p in (str(raw.get('VisitingZipCode') or ''), raw.get('VisitingCity') or '') if p),
            ) if p)
            rows.append(directory_record(
                'ica', ext, raw.get('MarketingName') or raw.get('Name'),
                address, raw.get('VisitingZipCode'), raw.get('VisitingCity'),
                raw.get('Latitude'), raw.get('Longitude'),
                home=url, prices=True, offers=True,
            ))
        return rows

    def _headers(self, external_id):
        return {
            'Referer': f'{ICA_SHOP}/stores/{external_id}',
            'Origin': ICA_SHOP,
        }

    def _rows(self, payload, store, fetched_at, query):
        rows = []
        for group in (payload or {}).get('productGroups') or []:
            for raw in group.get('decoratedProducts') or []:
                row = ica_product(raw, store['id'], store['external_id'], fetched_at, query)
                if row:
                    rows.append(row)
        return rows

    def search(self, store, term, limit, fetched_at):
        ext = quote(str(store['external_id']))
        payload = self.client.request(
            f'{ICA_SHOP}/stores/{ext}/api/webproductpagews/v6/product-pages/search'
            f'?q={quote(term)}&tag=web&maxPageSize={limit}&maxProductsToDecorate={limit}',
            headers=self._headers(store['external_id']),
        )
        return self._rows(payload, store, fetched_at, term)

    def offers(self, store, limit, fetched_at):
        ext = quote(str(store['external_id']))
        payload = self.client.request(
            f'{ICA_SHOP}/stores/{ext}/api/webproductpagews/v6/product-pages/promotions'
            f'?maxPageSize={limit}&maxProductsToDecorate={limit}',
            headers=self._headers(store['external_id']),
        )
        return self._rows(payload, store, fetched_at, '')
