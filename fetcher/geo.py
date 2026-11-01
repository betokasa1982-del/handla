"""Find shops near a point or a place name. Used by tests; the app has the same idea."""

import math
import re


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def nearby(stores, lat, lon, radius_km=15, limit=40):
    ranked = []
    for store in stores:
        if store.get('lat') is None or store.get('lon') is None:
            continue
        km = haversine_km(lat, lon, store['lat'], store['lon'])
        if km <= radius_km:
            ranked.append((km, store))
    ranked.sort(key=lambda pair: pair[0])
    return [{'km': round(km, 1), **store} for km, store in ranked[:limit]]


def match_place(stores, query, limit=40):
    """A 5-digit postcode, or a city / area name such as Kortedala."""
    raw = (query or '').strip()
    digits = re.sub(r'\D', '', raw)
    if len(digits) == 5:
        def code(store):
            return re.sub(r'\D', '', store.get('postcode') or '')
        exact = [s for s in stores if code(s) == digits]
        area = [s for s in stores if code(s).startswith(digits[:3]) and s not in exact]
        return (exact + area)[:limit]
    needle = raw.casefold()
    if len(needle) < 2:
        return []
    hits = []
    for store in stores:
        blob = ' '.join([
            store.get('city') or '',
            store.get('name') or '',
            store.get('address') or '',
        ]).casefold()
        if needle in blob:
            hits.append(store)
    hits.sort(key=lambda s: ((s.get('city') or ''), (s.get('name') or '')))
    return hits[:limit]
