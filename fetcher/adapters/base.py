import re

"""Chain adapter contract.

A chain plugin implements three things: list every shop, list this week's
offers for one shop, and search prices at one shop. The same classes are what
a future API service would call. GitHub Actions is only the first host.
"""


class Unsupported(RuntimeError):
    """This chain has no public feed for the requested operation."""


class ChainAdapter:
    chain = ''
    label = ''
    # False when we can list shops but not read prices (X:-tra today).
    prices = True
    offers = True

    def __init__(self, client):
        self.client = client

    def list_stores(self):
        raise NotImplementedError

    def search(self, store, term, limit, fetched_at):
        raise NotImplementedError

    def offers(self, store, limit, fetched_at):
        raise NotImplementedError


def directory_record(chain, external_id, name, address, postcode, city, lat, lon,
                     home='', prices=True, offers=True):
    ext = str(external_id).strip()
    try:
        lat = round(float(lat), 6) if lat is not None else None
        lon = round(float(lon), 6) if lon is not None else None
    except (TypeError, ValueError):
        lat = lon = None
    return {
        'id': f'{chain}-{ext}',
        'chain': chain,
        'external_id': ext,
        'name': (name or '').strip(),
        'address': (address or '').strip(),
        'postcode': re_postcode(postcode),
        'city': (city or '').strip(),
        'lat': lat,
        'lon': lon,
        'home': home or '',
        'prices': bool(prices),
        'offers': bool(offers),
    }


def re_postcode(value):
    digits = re.sub(r'\D', '', str(value or ''))
    if len(digits) == 5:
        return digits[:3] + ' ' + digits[3:]
    return str(value or '').strip()
