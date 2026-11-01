"""Turn chain-specific product JSON into one shape, and check that prices are sane."""

import re
from datetime import datetime, timezone

# A single grocery item. Saffron can be thousands of kr per kilo; a pack
# above 5 000 kr or a compare price above 20 000 kr/unit is treated as junk.
PRICE_MIN = 0.5
PRICE_MAX = 5000
COMPARE_MAX = 20000

_SIZE = re.compile(
    r'(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|dl|cl|ml|st|pcs|pack|p)\b',
    re.I,
)

_UNIT = {
    'l': 'l', 'liter': 'l', 'litre': 'l', 'per_litre': 'l', 'per_liter': 'l',
    'kg': 'kg', 'per_kg': 'kg', 'per_1kg': 'kg',
    'g': 'g', 'mg': 'g',
    'ml': 'ml', 'cl': 'cl', 'dl': 'dl',
    'st': 'st', 'pcs': 'st', 'p': 'st', 'pack': 'st', 'piece': 'st',
    'per_piece': 'st', 'per_item': 'st', 'per_each': 'st', 'each': 'st',
    'fop_price_per_item': 'st', 'fop_price_per_each': 'st', 'fop_price_per_piece': 'st',
    'fop_price_per_litre': 'l', 'fop_price_per_liter': 'l',
    'fop_price_per_kg': 'kg', 'fop_price_per_1kg': 'kg',
}


def parse_number(value):
    if value is None or value is False:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if value == value else None  # NaN
    text = str(value).strip().lower().replace('\xa0', '').replace(' ', '')
    text = text.replace('kr', '').replace(',', '.')
    text = re.sub(r'[^0-9.]', '', text)
    if not text or text.count('.') > 1:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def canon_unit(value):
    if not value:
        return ''
    key = str(value).strip().lower().replace(' ', '_').replace('/', '_').replace('.', '_')
    return _UNIT.get(key, '')


def _word_in_name(term, name):
    """True when one word of a search is the product, not a different word.

    'ägg' matches 'Gårdsägg'. 'hönö' matches 'Hönökaka'. 'mjöl' matches
    'Vetemjöl' and does not match 'mjölk' (that leftover is a single letter).
    """
    term = (term or '').strip().casefold()
    if not term:
        return False
    for word in re.split(r'[^a-z0-9åäö]+', name.casefold()):
        if not word:
            continue
        if word == term:
            return True
        if len(term) >= 3 and word.endswith(term):
            return True
        if len(term) >= 4 and word.startswith(term) and len(word) - len(term) >= 2:
            return True
        if len(term) >= 4 and word.startswith(term) and re.fullmatch(r'(ar|er|or|en|et|na|s)', word[len(term):]):
            return True
    return False


def term_in_name(term, name):
    """Every word of the search must appear in the product name."""
    parts = [p for p in re.split(r'[^a-z0-9åäö]+', (term or '').casefold()) if p]
    if not parts or not name:
        return False
    return all(_word_in_name(part, name) for part in parts)


def parse_size(text):
    """Return (amount, unit) from a pack description such as '1,5 l' or '500g'."""
    if not text:
        return None, ''
    match = _SIZE.search(str(text).lower().replace('liter', 'l'))
    if not match:
        return None, ''
    amount = parse_number(match.group(1))
    unit = canon_unit(match.group(2))
    if amount is None or amount <= 0 or not unit:
        return None, ''
    return amount, unit


def sane_price(value):
    return isinstance(value, (int, float)) and PRICE_MIN <= float(value) <= PRICE_MAX


def sane_compare(value):
    return value is None or (isinstance(value, (int, float)) and 0 < float(value) <= COMPARE_MAX)


def iso_date(value):
    """Accept an ISO string or epoch milliseconds. Return YYYY-MM-DD or ''."""
    if value is None or value == '':
        return ''
    if isinstance(value, (int, float)) and value > 10_000_000_000:
        value = value / 1000.0
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, timezone.utc).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return ''
    text = str(value).strip()
    if len(text) >= 10 and text[4] == '-' and text[7] == '-':
        return text[:10]
    return ''


def record(store, name, brand, price, size_text, compare_price, compare_unit,
           offer, offer_text, valid_until, url, image, fetched_at, query=''):
    size, unit = parse_size(size_text)
    compare = parse_number(compare_price)
    if not sane_compare(compare):
        compare = None
    unit_name = canon_unit(compare_unit) or unit
    return {
        'store': store,
        'name': (name or '').strip(),
        'brand': (brand or '').strip(),
        'size': size,
        'unit': unit,
        'price': round(float(price), 2),
        'compare_price': round(compare, 2) if compare is not None else None,
        'compare_unit': unit_name if compare is not None else '',
        'offer': bool(offer),
        'offer_text': (offer_text or '').strip(),
        'valid_until': iso_date(valid_until),
        'url': url or '',
        'image': (image or '').replace('http://res.cloudinary.com', 'https://res.cloudinary.com'),
        'fetched_at': fetched_at,
        'query': (query or '').strip(),
    }


def keep_sane(rows):
    """Drop rows with no name or an absurd pack price. Blank a wild compare price."""
    kept = []
    for row in rows:
        if not row.get('name') or not sane_price(row.get('price')):
            continue
        if row.get('compare_price') is not None and not sane_compare(row['compare_price']):
            row = dict(row)
            row['compare_price'] = None
            row['compare_unit'] = ''
        kept.append(row)
    return kept


def dedupe(rows):
    """One row per store + name + pack. An offer beats a plain search hit."""
    best = {}
    order = []
    for row in rows:
        key = (
            row['store'],
            row['name'].casefold(),
            row.get('size'),
            row.get('unit') or '',
        )
        current = best.get(key)
        if current is None:
            best[key] = row
            order.append(key)
            continue
        if row.get('offer') and not current.get('offer'):
            row = dict(row)
            row['query'] = row.get('query') or current.get('query') or ''
            best[key] = row
        elif current.get('query') == '' and row.get('query'):
            current['query'] = row['query']
    return [best[k] for k in order]
