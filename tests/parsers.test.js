// Tests des parseurs : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../js/csv.js');
require('../js/categories.js');
require('../js/banks.js');
const B = globalThis.Budget;

const ex = (f) => fs.readFileSync(path.join(__dirname, '..', 'exemples', f), 'utf8');
const cats = Object.fromEntries(B.DEFAULT_CATEGORIES.map((c) => [c.id, c]));
const cat = (desc, cents, hint) => B.categorize(desc, cents, [], cats, hint).categoryId;

test('montants', () => {
  assert.equal(B.parseAmount('-$37.36'), -3736);
  assert.equal(B.parseAmount('−$37.36'), -3736);
  assert.equal(B.parseAmount('1 234,56 $'), 123456);
  assert.equal(B.parseAmount('1,234.56'), 123456);
  assert.equal(B.parseAmount('1.234,56'), 123456);
  assert.equal(B.parseAmount('(12.50)'), -1250);
  assert.equal(B.parseAmount('12.50-'), -1250);
  assert.equal(B.parseAmount('54,2'), 5420);
  assert.equal(B.parseAmount('1,234'), 123400);
  assert.equal(B.parseAmount('CAD 45'), 4500);
  assert.equal(B.parseAmount('+2100'), 210000);
  assert.equal(B.parseAmount(''), null);
  assert.equal(B.parseAmount('METRO'), null);
  assert.equal(B.parseAmount('2026-10-01'), null);
});

test('dates', () => {
  assert.equal(B.parseDate('2026-10-05'), '2026-10-05');
  assert.equal(B.parseDate('2026/1/5'), '2026-01-05');
  assert.equal(B.parseDate('2026-10-05T14:22:00Z'), '2026-10-05');
  assert.equal(B.parseDate('05/10/2026', 'DMY'), '2026-10-05');
  assert.equal(B.parseDate('10/05/2026', 'MDY'), '2026-10-05');
  assert.equal(B.parseDate('25/10/2026'), '2026-10-25');
  assert.equal(B.parseDate('Nov 5, 2026'), '2026-11-05');
  assert.equal(B.parseDate('5 nov. 2026'), '2026-11-05');
  assert.equal(B.parseDate('05-Nov-2026'), '2026-11-05');
  assert.equal(B.parseDate('5 décembre 2026'), '2026-12-05');
  assert.equal(B.parseDate('2026-02-30'), null);
  assert.equal(B.parseDate('Description'), null);
  assert.equal(B.detectDateOrder(['02/10/2026', '21/10/2026']), 'DMY');
  assert.equal(B.detectDateOrder(['10/21/2026']), 'MDY');
});

test('CSV : guillemets, séparateur, BOM', () => {
  const rows = B.parseCSV('﻿"a","b, c"\r\n"d ""e""",f\n\n');
  assert.deepEqual(rows, [['a', 'b, c'], ['d "e"', 'f']]);
  assert.equal(B.detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(B.detectDelimiter('a\tb\n1\t2'), '\t');
});

test('CIBC carte de crédit', () => {
  const det = B.detect(ex('cibc-carte-credit-exemple.csv'));
  assert.equal(det.id, 'cibc-card');
  assert.equal(det.accountHint, 'CIBC carte •1234');
  const { items, skipped } = B.applyMapping(det.rows, det.mapping);
  assert.equal(skipped, 0);
  assert.equal(items.length, 18);
  assert.equal(items[0].amount, -8742);
  const pay = items.find((t) => t.description.startsWith('PAYMENT'));
  assert.equal(pay.amount, 85000);
  const refund = items.find((t) => t.date === '2026-10-18');
  assert.equal(refund.amount, 1299);
  // les deux cafés identiques du 27 restent distincts
  const keys = B.dedupeKeys(items);
  assert.equal(new Set(keys).size, items.length);
});

test('CIBC compte chèques', () => {
  const det = B.detect(ex('cibc-compte-cheques-exemple.csv'));
  assert.equal(det.id, 'cibc-account');
  const { items } = B.applyMapping(det.rows, det.mapping);
  assert.equal(items.length, 12);
  assert.equal(items[0].amount, 215000);
  assert.equal(items[2].amount, -132500);
});

test('Wealthsimple relevé mensuel', () => {
  const det = B.detect(ex('wealthsimple-cheques-exemple.csv'));
  assert.equal(det.id, 'ws-statement');
  const { items } = B.applyMapping(det.rows, det.mapping);
  assert.equal(items.length, 10);
  assert.equal(items[1].amount, -7318);
  const tfsa = items.find((t) => t.type === 'TRFOUT');
  assert.equal(tfsa.hint.strong, true);
  assert.equal(B.categorize(tfsa.description, tfsa.amount, [], cats, tfsa.hint).categoryId, 'transferts');
  const int = items.find((t) => t.type === 'INT');
  assert.equal(B.categorize(int.description, int.amount, [], cats, int.hint).categoryId, 'interets');
});

test('Wealthsimple export d’activités', () => {
  const csv = 'transaction_date,settlement_date,account_id,account_type,activity_type,activity_sub_type,direction,symbol,name,currency,quantity,unit_price,commission,net_cash_amount\n' +
    '2026-10-03,2026-10-04,H123,TFSA,Trade,BUY,LONG,XEQT,iShares Core Equity ETF,CAD,10,32.10,0,-321.00\n' +
    '2026-10-15,2026-10-15,H123,TFSA,Dividend,,,XEQT,iShares Core Equity ETF,CAD,,,,4.12\n';
  const det = B.detect(csv);
  assert.equal(det.id, 'ws-activities');
  const { items } = B.applyMapping(det.rows, det.mapping);
  assert.equal(items.length, 2);
  assert.equal(items[0].amount, -32100);
  assert.equal(B.categorize(items[0].description, items[0].amount, [], cats, items[0].hint).categoryId, 'placements');
  assert.equal(B.categorize(items[1].description, items[1].amount, [], cats, items[1].hint).categoryId, 'interets');
});

test('Format générique (point-virgule, JJ/MM/AAAA, retrait/dépôt)', () => {
  const det = B.detect(ex('autre-banque-generique-exemple.csv'));
  assert.equal(det.id, 'generic');
  assert.equal(det.mapping.hasHeader, true);
  assert.equal(det.mapping.dateOrder, 'DMY');
  const { items } = B.applyMapping(det.rows, det.mapping);
  assert.equal(items.length, 4);
  assert.equal(items[0].date, '2026-10-02');
  assert.equal(items[0].amount, -5420);
  assert.equal(items[1].amount, 198000);
});

test('Format générique sans en-tête', () => {
  const csv = '10/02/2026,COSTCO WHOLESALE #503,-210.44\n10/03/2026,PAYROLL ACME,1500.00\n10/15/2026,VIDEOTRON,-85.00\n';
  const det = B.detect(csv);
  assert.equal(det.mapping.hasHeader, false);
  const { items } = B.applyMapping(det.rows, det.mapping);
  assert.equal(items.length, 3);
  assert.equal(items[0].date, '2026-10-02');
  assert.equal(items[0].amount, -21044);
  assert.equal(items[0].description, 'COSTCO WHOLESALE #503');
});

test('Profil mémorisé (inverser les signes)', () => {
  const csv = 'Transaction Date,Details,Amount\n2026-10-02,METRO,45.10\n2026-10-03,PAYMENT,-300\n';
  const first = B.detect(csv);
  const saved = { [first.signature]: Object.assign({}, first.mapping, { invert: true }) };
  const again = B.detect(csv, saved);
  assert.equal(again.remembered, true);
  const { items } = B.applyMapping(again.rows, again.mapping);
  assert.equal(items[0].amount, -4510);
});

test('Catégorisation automatique', () => {
  assert.equal(cat('METRO PLUS ROSEMONT MONTREAL QC', -8742), 'epicerie');
  assert.equal(cat('UBER CANADA/UBEREATS TORONTO ON', -3140), 'restaurants');
  assert.equal(cat('UBER CANADA/UBERTRIP TORONTO ON', -1800), 'transport');
  assert.equal(cat('NETFLIX.COM 866-579-7172 ON', -2099), 'abonnements');
  assert.equal(cat('AMZN Mktp CA*ZX4RT5', -4597), 'magasinage');
  assert.equal(cat('PAYMENT THANK YOU/PAIEMENT MERCI', 85000), 'transferts');
  assert.equal(cat('Internet Banking INTERNET BILL PAY 000000123456 HYDRO-QUEBEC', -9612), 'factures');
  assert.equal(cat('Electronic Funds Transfer PAY ACME INC', 215000), 'salaire');
  assert.equal(cat('Internet Banking INTERNET BILL PAY 000000654321 VIDEOTRON', -8500), 'factures');
  assert.equal(cat('PAYPAL *STEAM', -1999), 'loisirs');
  assert.equal(cat('Direct deposit from ACME INC PAYROLL', 185000), 'salaire');
  assert.equal(cat('Electronic Funds Transfer DEPOSIT CANADA FED GST', 12975), 'gouvernement');
  assert.equal(cat('Service Charge MONTHLY FEES', -1695), 'frais');
  assert.equal(cat('BARBIER DU COIN', -2500), null);
  assert.equal(cat('CAMPBELL RIVER', -2500), null);
  // un revenu n'est jamais attribué à une dépense
  assert.equal(cat('REMBOURSEMENT PRET', -50000), null);
  // règle utilisateur prioritaire
  const user = [{ id: 'u1', pattern: 'costco', categoryId: 'magasinage' }];
  assert.equal(B.categorize('COSTCO WHOLESALE #503', -21044, user, cats).categoryId, 'magasinage');
});

test('Mot-clé de commerce', () => {
  assert.equal(B.merchantKey('Point of Sale - Interac RETAIL PURCHASE 000001234567 SUPER C #0456'), 'super c');
  assert.equal(B.merchantKey('TIM HORTONS #4521 MONTREAL QC'), 'tim hortons');
  assert.equal(B.merchantKey('COSTCO WHOLESALE #503'), 'costco');
  assert.equal(B.merchantKey('Purchase at STARBUCKS 4352'), 'starbucks');
  assert.equal(B.merchantKey('Purchase at IGA EXTRA FAMILLE DUCHARME'), 'iga extra');
  assert.ok(B.matchesKey('TIM HORTONS #999 LAVAL', 'tim hortons'));
});
