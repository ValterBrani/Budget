// Tests des parseurs : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../js/csv.js');
require('../js/icons.js');
require('../js/categories.js');
require('../js/banks.js');
require('../js/store.js');
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
  // Un virement vers un CELI est un investissement, pas un simple transfert
  const tfsa = items.find((t) => t.type === 'TRFOUT');
  assert.equal(B.categorize(tfsa.description, tfsa.amount, [], cats, tfsa.hint).categoryId, 'investissement');
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
  // Un achat de titres dans un compte de placement n'est ni un revenu ni une dépense
  assert.equal(B.categorize(items[0].description, items[0].amount, [], cats, items[0].hint).categoryId, 'transferts');
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

const catOf = (t, rules) => B.categorize(t.description, t.amount, rules || [], cats, t.hint).categoryId;

test('Wealthsimple carte de crédit (credit-card-activities)', () => {
  const det = B.detect(ex('wealthsimple-carte-credit-exemple.csv'));
  assert.equal(det.id, 'ws-card');
  assert.equal(det.accountHint, 'Wealthsimple carte de crédit');
  const { items, skipped } = B.applyMapping(det.rows, det.mapping);
  assert.equal(skipped, 0);
  assert.equal(items.length, 12);
  const by = (txt) => items.find((t) => t.description.startsWith(txt));
  // Le paiement reçu sur la carte est un transfert, jamais un revenu
  const pay = by('Paiement reçu');
  assert.equal(pay.amount, 28415);
  assert.equal(catOf(pay), 'transferts');
  assert.equal(pay.noRule, true);
  // La catégorie donnée par la banque passe avant les mots-clés intégrés…
  assert.equal(catOf(by('Zzz Commerce')), 'loisirs');
  assert.equal(catOf(by('Boulangerie')), 'restaurants');
  assert.equal(catOf(by('Fizz')), 'factures');
  assert.equal(catOf(by('Clinique Dentaire')), 'sante');
  // …sauf quand elle est trop vague (« Entretien ») : le mot-clé « antirouille » l'emporte sur « metro »
  assert.equal(catOf(by('Antirouille')), 'transport');
  // …et une règle de l'utilisateur passe avant la banque
  assert.equal(catOf(by('Fizz'), [{ id: 'u', pattern: 'fizz', categoryId: 'abonnements' }]), 'abonnements');
  // Un remboursement garde la catégorie du commerce (il réduit la dépense)
  const refund = items.find((t) => t.type === 'Refund');
  assert.equal(refund.amount, 2500);
  assert.equal(catOf(refund), 'magasinage');
});

test('Wealthsimple compte chèques (chequing-activities)', () => {
  const det = B.detect(ex('wealthsimple-compte-cheques-exemple.csv'));
  assert.equal(det.id, 'ws-chequing');
  const { items, skipped } = B.applyMapping(det.rows, det.mapping);
  assert.equal(skipped, 0);
  assert.equal(items.length, 15);
  const by = (txt) => items.find((t) => t.description.startsWith(txt));
  assert.equal(catOf(by('Paiement de la carte de crédit')), 'transferts');
  assert.equal(catOf(by('Intérêts')), 'interets');
  assert.equal(catOf(by('PAIE/PAYROLL')), 'salaire');
  assert.equal(catOf(by('BANQUE MTGE')), 'logement');
  assert.equal(catOf(by('HYDRO')), 'factures');
  assert.equal(catOf(by('Syndicat')), 'logement');
  assert.equal(catOf(by('Prime Wealthsimple')), 'autres-revenus');
  assert.equal(catOf(by('Dépôt en argent')), 'autres-revenus');
  // Paiement de facture vers une carte de crédit : transfert
  assert.equal(catOf(by('visa banque exemple')), 'transferts');
  // Virement à une personne : à classer par l'utilisateur, règle par bénéficiaire
  const alex = by('Alex Exemple');
  assert.equal(alex.description, 'Alex Exemple · Souper');
  assert.equal(catOf(alex), null);
  assert.equal(alex.ruleKey, 'alex exemple');
  assert.ok(!JSON.stringify(items).includes('example.com'), "l'adresse courriel du bénéficiaire n'est pas conservée");
  // Virements internes : la note dit où va l'argent
  const urgence = items.find((t) => /urgence/i.test(t.description));
  assert.equal(urgence.description, 'Virement interne (sortie) · Compte urgence');
  assert.equal(catOf(urgence), 'epargne');
  assert.equal(urgence.ruleKey, 'compte urgence');
  assert.equal(catOf(items.find((t) => /CELI/.test(t.description))), 'investissement');
  // Sans note : transfert, et aucune règle ne peut en être tirée
  const plain = items.filter((t) => t.description === 'Virement interne (sortie)');
  assert.equal(plain.length, 2);
  assert.equal(catOf(plain[0]), 'transferts');
  assert.equal(plain[0].noRule, true);
  assert.equal(catOf(by('Virement interne (entrée)')), 'transferts');
  // Une règle de l'utilisateur sur la note passe avant
  assert.equal(catOf(urgence, [{ id: 'u', pattern: 'compte urgence ', categoryId: 'fond-prevoyance' }]), 'fond-prevoyance');
  // Deux virements identiques le même jour restent distincts
  const keys = B.dedupeKeys(items);
  assert.equal(new Set(keys).size, items.length);
  // La clé de doublon repose sur le texte du relevé, pas sur le libellé affiché
  assert.ok(keys.some((k) => k.startsWith('2026-03-06|-28415|credit card payment#')));
  assert.ok(keys.some((k) => k.startsWith('2026-03-02|-7500|internal transfer#')));
});

test('Statut des lignes : annulée ignorée, en attente signalée', () => {
  const csv = 'transaction_date,transaction_type,status,merchant,amount,currency,notes,category\n' +
    '2026-10-08,Purchase,Completed,Magasin A,-10.00,CAD,,Épicerie\n' +
    '2026-10-08,Purchase,Pending,Magasin B,-20.00,CAD,,Épicerie\n' +
    '2026-10-08,Purchase,Declined,Magasin C,-30.00,CAD,,Épicerie\n';
  const det = B.detect(csv);
  const { items, cancelled } = B.applyMapping(det.rows, det.mapping);
  assert.equal(items.length, 2);
  assert.equal(cancelled, 1);
  assert.deepEqual(items.map((t) => t.pending), [false, true]);
});

test('Profil mémorisé sur un format connu : les colonnes spéciales sont gardées', () => {
  const text = ex('wealthsimple-carte-credit-exemple.csv');
  const first = B.detect(text);
  // Ancien profil générique enregistré avant que le format soit reconnu
  const saved = { [first.signature]: { hasHeader: true, date: 0, description: 3, amount: 4, type: 1, dateOrder: 'YMD', label: 'Format générique' } };
  const again = B.detect(text, saved);
  assert.equal(again.id, 'ws-card');
  assert.equal(again.mapping.hint, 'ws-card');
  const { items } = B.applyMapping(again.rows, again.mapping);
  assert.equal(catOf(items.find((t) => t.type === 'Payment')), 'transferts');
});

test('Sens du montant, mises de côté et investissement', () => {
  // Intérêts débités sur une carte = frais ; intérêts crédités = revenu
  assert.equal(cat('INTERET', -127), 'frais');
  assert.equal(cat('INTERET', 127), 'interets');
  assert.equal(cat('Interest DEPOSIT INTEREST', 42), 'interets');
  assert.equal(cat('PAYMENT THANK YOU/PAIEMEN T MERCI', 42000), 'transferts');
  assert.equal(cat('COSTCO ESSENCE W123 LAVAL, QC', -6512), 'transport');
  assert.equal(cat('COSTCO WHOLESALE W123 LAVAL, QC', -9875), 'epicerie');
  assert.equal(cat('STH #101 BOUL EXEMPLE LAVAL, QC', -1890), 'restaurants');
  assert.equal(cat('Wal-Mart Supercenter#1000', -1234), 'epicerie');
  assert.equal(cat('Virement compte urgence', -10000), 'epargne');
  assert.equal(cat('Virement CELI placements', -40000), 'investissement');
  assert.equal(cat('Versement fond de prévoyance', -40000), 'fond-prevoyance');
  assert.equal(cat('PREAUTHORIZED DEBIT WEALTHSIMPLE', -25000), 'transferts');
  assert.equal(B.potFromNote('Faire grossir le compte urgence'), 'epargne');
  assert.equal(B.potFromNote('REER 2026'), 'investissement');
  assert.equal(B.potFromNote(''), null);
  assert.equal(B.potFromNote('souper de fête'), null);
  // Mot-clé fourni par le relevé : mot complet seulement
  assert.ok(B.matchesKey('AGA', 'aga '));
  assert.ok(!B.matchesKey('AGATHE BOUTIQUE', 'aga '));
  assert.ok(B.matchesKey('AGATHE BOUTIQUE', 'aga'));
});

test('Données de la version 1 : les nouvelles catégories sont ajoutées sans rien perdre', () => {
  const v1cats = B.DEFAULT_CATEGORIES.filter((c) => !B.V2_CATEGORY_IDS.includes(c.id)).map((c) => Object.assign({ budget: 0 }, c));
  v1cats.push({ id: 'placements', name: 'Épargne et placements', icon: '🏦', kind: 'transfer', budget: 0 });
  v1cats.find((c) => c.id === 'epicerie').budget = 60000;
  const old = { app: 'budget-par-claude', version: 1, categories: v1cats, rules: [], accounts: [], profiles: {}, settings: {},
    transactions: [{ id: 'a', date: '2026-10-01', desc: 'METRO', amount: -1000, cat: 'epicerie' }] };
  const s = B.migrate(JSON.parse(JSON.stringify(old)));
  assert.equal(s.version, 3);
  for (const id of B.V2_CATEGORY_IDS) assert.ok(s.categories.some((c) => c.id === id), id);
  assert.equal(s.categories.find((c) => c.id === 'epicerie').budget, 60000);
  assert.equal(s.transactions.length, 1);
  // « Épargne et placements » inutilisée : retirée. Utilisée : gardée.
  assert.ok(!s.categories.some((c) => c.id === 'placements'));
  const used = JSON.parse(JSON.stringify(old));
  used.transactions.push({ id: 'b', date: '2026-10-02', desc: 'CELI', amount: -5000, cat: 'placements' });
  assert.ok(B.migrate(used).categories.some((c) => c.id === 'placements'));
  // Une deuxième migration ne change plus rien
  const n = s.categories.length;
  assert.equal(B.migrate(s).categories.length, n);
});

test('Icônes : chaque catégorie par défaut et chaque choix offert existe', () => {
  for (const c of B.DEFAULT_CATEGORIES) assert.ok(B.ICONS[c.icon], `${c.id} : ${c.icon}`);
  const offered = B.ICON_GROUPS.flatMap(([, items]) => items.map(([name]) => name));
  assert.equal(new Set(offered).size, offered.length);
  for (const name of offered) assert.ok(B.ICONS[name], name);
  for (const c of B.DEFAULT_CATEGORIES) assert.ok(offered.includes(c.icon), `${c.icon} doit être offerte`);
  // Un nom inconnu donne l'étiquette, jamais une icône vide
  assert.equal(B.icon('inconnue'), B.icon('tag'));
  assert.ok(B.icon('house').startsWith('<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path'));
});

test('Données de la version 2 : les emoji des catégories deviennent des icônes', () => {
  const emoji = { logement: '🏠', restaurants: '🍽️', voyages: '✈️', remboursements: '↩️', 'fond-prevoyance': '☂️', epargne: '🐷' };
  const cats = B.DEFAULT_CATEGORIES.map((c) => Object.assign({ budget: 0 }, c, { icon: emoji[c.id] || '📦' }));
  cats.find((c) => c.id === 'transport').icon = '🚲'; // emoji inconnu sur une catégorie par défaut
  cats.push({ id: 'garderie', name: 'Garderie', icon: '🏷️', kind: 'expense', budget: 12000 });
  cats.push({ id: 'perso', name: 'Perso', icon: '🦄', kind: 'expense', budget: 0 });
  const s = B.migrate({ app: 'budget-par-claude', version: 2, categories: cats, rules: [], accounts: [], profiles: {}, settings: {}, transactions: [] });
  assert.equal(s.version, 3);
  const icon = (id) => s.categories.find((c) => c.id === id).icon;
  assert.equal(icon('logement'), 'house');
  assert.equal(icon('restaurants'), 'utensils');
  assert.equal(icon('voyages'), 'plane');
  assert.equal(icon('remboursements'), 'undo-2');
  assert.equal(icon('fond-prevoyance'), 'umbrella');
  assert.equal(icon('epargne'), 'piggy-bank');
  assert.equal(icon('transport'), 'car');
  assert.equal(icon('garderie'), 'tag');
  assert.equal(icon('perso'), 'tag');
  assert.equal(s.categories.find((c) => c.id === 'garderie').budget, 12000);
  for (const c of s.categories) assert.ok(B.ICONS[c.icon], c.id);
  // Une icône déjà choisie n'est pas touchée par une nouvelle migration
  s.categories.find((c) => c.id === 'perso').icon = 'star';
  s.version = 2;
  assert.equal(B.migrate(s).categories.find((c) => c.id === 'perso').icon, 'star');
});
