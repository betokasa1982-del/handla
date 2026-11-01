"""Normalizer and stale-data rules. No network."""

import unittest

from fetcher.normalize import (
    dedupe, iso_date, keep_sane, parse_number, parse_size, record, sane_price,
    term_in_name,
)
from fetcher.pipeline import merge_store
from fetcher.sources import coop_product, ica_product, willys_product


class NormalizeTests(unittest.TestCase):
    def test_term_must_appear_in_the_name(self):
        self.assertTrue(term_in_name('ägg', 'Gårdsägg M/L 10-p'))
        self.assertTrue(term_in_name('mjölk', 'Mellanmjölk 1,5%'))
        self.assertFalse(term_in_name('ägg', 'Majonäs Seriously Good'))
        self.assertFalse(term_in_name('banan', 'Proteinbar Delicat'))
        self.assertFalse(term_in_name('mjöl', 'Mellanmjölk 1,5%'))
        self.assertTrue(term_in_name('mjöl', 'Vetemjöl 2 kg'))

    def test_swedish_numbers_and_pack_size(self):
        self.assertEqual(parse_number('16,50 kr'), 16.5)
        self.assertEqual(parse_number('11.00'), 11.0)
        self.assertIsNone(parse_number(''))
        self.assertEqual(parse_size('1,5l'), (1.5, 'l'))
        self.assertEqual(parse_size('500 g'), (500.0, 'g'))
        self.assertEqual(parse_size('0.5kg'), (0.5, 'kg'))

    def test_sane_range(self):
        self.assertTrue(sane_price(16.5))
        self.assertFalse(sane_price(0))
        self.assertFalse(sane_price(0.1))
        self.assertFalse(sane_price(9000))
        rows = keep_sane([
            record('s', 'Milk', 'A', 16.5, '1.5 l', 11, 'l', False, '', '', '', '', 't', 'mjölk'),
            record('s', 'Gold bar', 'A', 99999, '1 kg', 10, 'kg', False, '', '', '', '', 't'),
            record('s', '', 'A', 10, '1 l', 10, 'l', False, '', '', '', '', 't'),
        ])
        self.assertEqual([row['name'] for row in rows], ['Milk'])

    def test_epoch_and_iso_dates(self):
        self.assertEqual(iso_date('2026-11-02T23:00:00Z'), '2026-11-02')
        self.assertEqual(iso_date(1793573999000), '2026-11-01')

    def test_willys_offer_fields(self):
        row = willys_product({
            'name': 'Lime Klass 1',
            'manufacturer': 'Frukt',
            'priceValue': 5.9,
            'price': '5,90 kr',
            'comparePrice': '29,50 kr',
            'comparePriceUnit': 'kg',
            'displayVolume': '200g',
            'code': '101200430_ST',
            'image': {'url': 'https://assets.axfood.se/lime.jpg'},
            'potentialPromotions': [{
                'conditionLabel': '5 för',
                'textLabelGenerated': 'Klubbpris',
                'validUntil': 1793573999000,
            }],
        }, 'willys-varvader', '2026-11-01T02:00:00+00:00')
        self.assertEqual(row['store'], 'willys-varvader')
        self.assertEqual(row['price'], 5.9)
        self.assertEqual(row['size'], 200.0)
        self.assertEqual(row['unit'], 'g')
        self.assertEqual(row['compare_price'], 29.5)
        self.assertEqual(row['compare_unit'], 'kg')
        self.assertTrue(row['offer'])
        self.assertIn('Klubbpris', row['offer_text'])
        self.assertEqual(row['valid_until'], '2026-11-01')
        self.assertTrue(row['url'].endswith('/produkt/101200430_ST'))

    def test_ica_promo_price_wins(self):
        row = ica_product({
            'name': 'Grillkorv 500g ICA',
            'brand': 'ICA',
            'packSizeDescription': '0.5kg',
            'price': {'amount': '24.95', 'currency': 'SEK'},
            'promoPrice': {'amount': '20.00', 'currency': 'SEK'},
            'unitPrice': {'price': {'amount': '49.90'}, 'unitName': 'PER_1KG'},
            'promoUnitPrice': {'price': {'amount': '40.00'}, 'unitName': 'PER_1KG'},
            'promotions': [{'description': '20 kr/st -- Stammispris', 'type': 'OFFER'}],
            'retailerProductId': '123',
            'image': {'src': 'https://handlaprivatkund.ica.se/images-v3/x/300x300.jpg'},
        }, 'ica-sannegarden', '1004293', '2026-11-01T02:00:00+00:00', 'korv')
        self.assertEqual(row['price'], 20.0)
        self.assertEqual(row['compare_price'], 40.0)
        self.assertEqual(row['compare_unit'], 'kg')
        self.assertEqual(row['size'], 0.5)
        self.assertEqual(row['unit'], 'kg')
        self.assertTrue(row['offer'])
        self.assertIn('Stammispris', row['offer_text'])
        self.assertIn('/stores/1004293/products/123', row['url'])
        self.assertEqual(row['query'], 'korv')

    def test_coop_multibuy_and_https_image(self):
        row = coop_product({
            'type': 'Product',
            'name': 'Standardmjölk Längre Hållbarhet',
            'manufacturerName': 'Coop',
            'ean': '7300156581006',
            'packageSizeInformation': '1.5 l',
            'salesPriceData': {'b2cPrice': 16.5},
            'comparativePriceData': {'b2cPrice': 11.0},
            'comparativePriceUnit': {'unit': 'liter'},
            'imageUrl': 'http://res.cloudinary.com/coopsverige/image/upload/milk.tiff',
            'onlinePromotions': [{
                'message': '2FÖR30 Mjölk 1.5l',
                'endDate': '2027-10-03T22:00:00Z',
                'priceData': {'b2cPrice': 30.0},
            }],
        }, 'coop-eriksberg', '2026-11-01T02:00:00+00:00', 'mjölk')
        self.assertEqual(row['price'], 16.5)
        self.assertEqual(row['compare_price'], 11.0)
        self.assertEqual(row['compare_unit'], 'l')
        self.assertTrue(row['offer'])
        self.assertEqual(row['valid_until'], '2027-10-03')
        self.assertTrue(row['image'].startswith('https://res.cloudinary.com'))

    def test_dedupe_keeps_the_offer_and_the_search_term(self):
        plain = record('s', 'Milk', 'A', 16.5, '1.5 l', 11, 'l', False, '', '', '', '', 't', 'mjölk')
        offer = record('s', 'Milk', 'A', 16.5, '1.5 l', 11, 'l', True, '2 för 30', '2026-11-08', '', '', 't', '')
        rows = dedupe([plain, offer])
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]['offer'])
        self.assertEqual(rows[0]['query'], 'mjölk')
        self.assertEqual(rows[0]['offer_text'], '2 för 30')


class StaleTests(unittest.TestCase):
    def test_failure_keeps_last_good_rows(self):
        previous = {
            'products': [
                record('coop-eriksberg', 'Milk', 'Coop', 16.5, '1.5 l', 11, 'l',
                       False, '', '', '', '', '2026-10-31T02:00:00+00:00', 'mjölk'),
                record('ica-sannegarden', 'Bread', 'Pågen', 25, '500 g', 50, 'kg',
                       False, '', '', '', '', '2026-10-31T02:00:00+00:00', 'bröd'),
            ],
            'stores': [{
                'id': 'coop-eriksberg', 'fetched_at': '2026-10-31T02:00:00+00:00', 'name': 'Coop',
            }],
        }
        rows, meta, failed = merge_store(
            previous,
            {'id': 'coop-eriksberg', 'name': 'Coop Eriksberg', 'chain': 'coop'},
            {'ok': False, 'error': 'HTTP 503'},
            '2026-11-01T02:00:00+00:00',
        )
        self.assertTrue(failed)
        self.assertTrue(meta['stale'])
        self.assertEqual(meta['error'], 'HTTP 503')
        self.assertEqual(meta['fetched_at'], '2026-10-31T02:00:00+00:00')
        self.assertEqual([row['name'] for row in rows], ['Milk'])

    def test_success_replaces_rows(self):
        fresh = record('coop-eriksberg', 'New milk', 'Coop', 15.95, '1.5 l', 10.63, 'l',
                       True, '2 för 30', '', '', '', '2026-11-01T02:00:00+00:00', 'mjölk')
        rows, meta, failed = merge_store(
            {'products': [], 'stores': []},
            {'id': 'coop-eriksberg', 'name': 'Coop Eriksberg', 'chain': 'coop'},
            {'ok': True, 'products': [fresh], 'error': ''},
            '2026-11-01T02:00:00+00:00',
        )
        self.assertFalse(failed)
        self.assertFalse(meta['stale'])
        self.assertEqual(meta['offer_count'], 1)
        self.assertEqual(rows[0]['name'], 'New milk')


if __name__ == '__main__':
    unittest.main()
