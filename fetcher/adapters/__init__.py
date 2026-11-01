"""Enabled chain plugins. Add a class and list it in ADAPTERS to grow."""

from .axfood import Hemkop, Willys
from .coop import CityGross, Coop, Lidl, Xtra
from .ica import Ica

# Order is the order shown when several shops are the same distance.
ADAPTERS = [Willys, Hemkop, Ica, Coop, Xtra, Lidl, CityGross]


def enabled_adapters(client):
    out = []
    for cls in ADAPTERS:
        if getattr(cls, 'enabled', True) is False:
            continue
        out.append(cls(client))
    return out


def adapter_for(chain, client, cache):
    if chain not in cache:
        cls = next(c for c in ADAPTERS if c.chain == chain)
        cache[chain] = cls(client)
    return cache[chain]
