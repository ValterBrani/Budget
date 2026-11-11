/* Reconnaissance des relevés bancaires (CIBC, Wealthsimple, format générique)
   et conversion en transactions. */
(function (root) {
  'use strict';
  const B = (root.Budget = root.Budget || {});

  // Noms de colonnes reconnus (après normalisation : minuscules, sans accents, « _ » → espace).
  const SYNONYMS = {
    date: ['date', 'transaction date', 'date de transaction', 'date transaction', 'trans date', 'date operation',
      'date de l operation', 'date d operation', 'posted date', 'post date', 'posting date', 'date d inscription',
      'date de comptabilisation', 'settlement date', 'value date', 'jour'],
    description: ['description', 'details', 'detail', 'transaction details', 'payee', 'beneficiaire', 'merchant',
      'marchand', 'commercant', 'libelle', 'narrative', 'name', 'nom', 'description 1', 'memo'],
    amount: ['amount', 'montant', 'net cash amount', 'transaction amount', 'montant de la transaction', 'cad',
      'amount cad', 'montant cad', 'value', 'valeur', 'total'],
    debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'retrait', 'retraits', 'money out', 'sortie', 'sorties',
      'paid out', 'debit amount', 'montant debit'],
    credit: ['credit', 'credits', 'deposit', 'deposits', 'depot', 'depots', 'money in', 'entree', 'entrees',
      'paid in', 'credit amount', 'montant credit'],
    type: ['transaction', 'type', 'activity type', 'transaction type', 'type de transaction', 'category', 'categorie'],
    subtype: ['activity sub type', 'sub type', 'subtype'],
    card: ['card number', 'numero de carte', 'card', 'carte', 'card no'],
  };
  const FIELDS = ['date', 'description', 'amount', 'debit', 'credit', 'type', 'subtype', 'card'];

  const isDate = (v) => B.parseDate(v) != null;
  const isNum = (v) => B.parseAmount(v) != null;
  const isEmpty = (v) => v == null || String(v).trim() === '';
  const isMaskedCard = (v) => /^\d{4}\*{2,}\d{2,4}$|^\*{2,}\d{3,4}$|^\d{4}[ x*]+\d{4}$/i.test(String(v || '').replace(/\s/g, ''));

  /** La première ligne est-elle un en-tête ? */
  function looksLikeHeader(rows) {
    if (rows.length < 2) return false;
    const first = rows[0];
    const anyDate = first.some(isDate);
    const anyNum = first.some((v) => isNum(v));
    const knownNames = first.filter((h) => findField(B.normalizeText(h))).length;
    if (knownNames >= 2) return true;
    return !anyDate && !anyNum;
  }

  function findField(h) {
    for (const f of FIELDS) if (SYNONYMS[f].includes(h)) return f;
    return null;
  }

  /** Associe les colonnes d'un en-tête aux champs connus. */
  function mapHeader(header) {
    const H = header.map((h) => B.normalizeText(h));
    const map = {};
    const used = new Set();
    // 1) correspondance exacte, en respectant l'ordre de préférence des synonymes
    for (const f of FIELDS) {
      for (const syn of SYNONYMS[f]) {
        const i = H.findIndex((h, idx) => h === syn && !used.has(idx));
        if (i > -1) { map[f] = i; used.add(i); break; }
      }
    }
    // 2) correspondance partielle pour les champs manquants
    for (const f of ['date', 'description', 'amount', 'debit', 'credit']) {
      if (map[f] != null) continue;
      for (const syn of SYNONYMS[f]) {
        if (syn.length < 4) continue;
        const i = H.findIndex((h, idx) => !used.has(idx) && h.includes(syn));
        if (i > -1) { map[f] = i; used.add(i); break; }
      }
    }
    return { map, H };
  }

  /** Devine les colonnes d'un fichier sans en-tête à partir du contenu. */
  function inferColumns(rows) {
    const n = Math.max(...rows.map((r) => r.length));
    const sample = rows.slice(0, 60);
    const stats = [];
    for (let c = 0; c < n; c++) {
      const vals = sample.map((r) => r[c]);
      const filled = vals.filter((v) => !isEmpty(v));
      stats.push({
        c,
        date: filled.length ? filled.filter(isDate).length / filled.length : 0,
        num: filled.length ? filled.filter(isNum).length / filled.length : 0,
        fill: filled.length / vals.length,
        avgLen: filled.reduce((a, v) => a + String(v).length, 0) / (filled.length || 1),
        card: filled.length ? filled.filter(isMaskedCard).length / filled.length : 0,
      });
    }
    const map = {};
    const dateCol = stats.find((s) => s.date > 0.8);
    if (dateCol) map.date = dateCol.c;
    const text = stats.filter((s) => s.c !== map.date && s.num < 0.5 && s.card < 0.5).sort((a, b) => b.avgLen - a.avgLen)[0];
    if (text) map.description = text.c;
    const nums = stats.filter((s) => s.c !== map.date && s.c !== map.description && s.num > 0.9 && s.card < 0.5);
    // Deux colonnes numériques partiellement remplies = débit / crédit
    const partial = nums.filter((s) => s.fill < 0.98);
    if (partial.length >= 2) { map.debit = partial[0].c; map.credit = partial[1].c; }
    else if (nums.length) map.amount = nums[0].c;
    const card = stats.find((s) => s.card > 0.8);
    if (card) map.card = card.c;
    return map;
  }

  function signature(rows, hasHeader) {
    if (hasHeader) return 'h:' + rows[0].map((h) => B.normalizeText(h)).join('|');
    return 'n:' + Math.max(...rows.slice(0, 20).map((r) => r.length));
  }

  // Codes de la colonne « transaction » des relevés Wealthsimple.
  function wealthsimpleHint(code) {
    const c = String(code || '').toUpperCase().trim();
    if (!c) return null;
    if (/^(BUY|SELL|CONT|CONTRIBUTION|DRIP|REINVEST|SPLIT|STKDIS|CRYPTO)/.test(c)) return { categoryId: 'placements', strong: true };
    if (/^(TRFIN|TRFOUT|TRFINTF|TRFOUTTF|TRF|INTERNAL|TRANSFER|WD$|WITHDRAWAL$|DEP$|DEPOSIT$|LOAN|RECALL)/.test(c)) return { categoryId: 'transferts', strong: true };
    if (/^(INT|INTEREST|FPLINT)/.test(c)) return { categoryId: 'interets', strong: true };
    if (/^(DIV|DIVIDEND|NRT|DISTRIBUTION)/.test(c)) return { categoryId: 'interets', strong: true };
    if (/^(FEE|FEES|NRTFEE|FRAIS)/.test(c)) return { categoryId: 'frais', strong: true };
    if (/^(REFUND|REIMB|CASHBACK|REWARD|PROMO|BONUS)/.test(c)) return { categoryId: 'remboursements', strong: false };
    if (/TRADE/.test(c)) return { categoryId: 'placements', strong: true };
    if (/MONEYMOVEMENT|MONEY MOVEMENT|INSTITUTIONAL/.test(c)) return { categoryId: 'transferts', strong: true };
    return null;
  }

  // Formats connus ---------------------------------------------------------

  function detectWealthsimple(rows) {
    const { map, H } = mapHeader(rows[0]);
    const has = (n) => H.includes(n);
    // Relevé mensuel : date, transaction, description, amount, balance(, currency)
    if (has('date') && has('transaction') && has('description') && has('amount')) {
      return {
        id: 'ws-statement', label: 'Wealthsimple (relevé mensuel)', bank: 'Wealthsimple', accountHint: 'Wealthsimple',
        mapping: { hasHeader: true, date: H.indexOf('date'), description: H.indexOf('description'),
          amount: H.indexOf('amount'), type: H.indexOf('transaction'), hint: 'wealthsimple' },
      };
    }
    // Export d'activités : transaction_date, …, activity_type, activity_sub_type, name, net_cash_amount
    if ((has('transaction date') || has('date')) && has('net cash amount')) {
      return {
        id: 'ws-activities', label: "Wealthsimple (export d'activités)", bank: 'Wealthsimple', accountHint: 'Wealthsimple',
        mapping: { hasHeader: true, date: H.indexOf(has('transaction date') ? 'transaction date' : 'date'),
          description: H.indexOf('name') > -1 ? H.indexOf('name') : (map.description != null ? map.description : null),
          amount: H.indexOf('net cash amount'), type: H.indexOf('activity type'), subtype: H.indexOf('activity sub type'),
          hint: 'wealthsimple' },
      };
    }
    return null;
  }

  function detectCIBC(rows) {
    // CIBC : pas d'en-tête ; date AAAA-MM-JJ, description, débit, crédit (, numéro de carte masqué)
    const sample = rows.slice(0, 40);
    const n = sample[0].length;
    if (n < 4 || n > 5) return null;
    if (!sample.every((r) => r.length === n)) return null;
    const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!sample.every((r) => isoDate(r[0]))) return null;
    const okNum = (v) => isEmpty(v) || isNum(v);
    if (!sample.every((r) => okNum(r[2]) && okNum(r[3]))) return null;
    if (!sample.every((r) => isEmpty(r[2]) !== isEmpty(r[3]))) return null;
    const isCard = n === 5 && sample.some((r) => isMaskedCard(r[4]));
    let accountHint = 'CIBC';
    if (isCard) {
      const card = sample.map((r) => r[4]).find(isMaskedCard) || '';
      const last4 = card.replace(/\D/g, '').slice(-4);
      accountHint = last4 ? `CIBC carte •${last4}` : 'CIBC carte de crédit';
    }
    return {
      id: isCard ? 'cibc-card' : 'cibc-account',
      label: isCard ? 'CIBC (carte de crédit)' : 'CIBC (compte bancaire)',
      bank: 'CIBC', accountHint,
      mapping: { hasHeader: false, date: 0, description: 1, debit: 2, credit: 3, card: isCard ? 4 : null, dateOrder: 'YMD' },
    };
  }

  /**
   * Analyse un CSV et propose une configuration.
   * savedProfiles : { signature: mapping } mémorisés lors d'imports précédents.
   */
  function detect(text, savedProfiles) {
    const rows = B.parseCSV(text);
    if (!rows.length) return { rows, error: 'Le fichier est vide.' };
    const hasHeader = looksLikeHeader(rows);
    const sig = signature(rows, hasHeader);
    let det = null;
    if (hasHeader) det = detectWealthsimple(rows);
    if (!det && !hasHeader) det = detectCIBC(rows);
    if (savedProfiles && savedProfiles[sig]) {
      const saved = savedProfiles[sig];
      det = Object.assign({}, det || { id: 'saved', label: 'Format mémorisé', bank: '', accountHint: '' },
        { mapping: Object.assign({}, saved), remembered: true });
      if (saved.label) det.label = saved.label;
    }
    if (!det) {
      let map;
      if (hasHeader) map = mapHeader(rows[0]).map;
      else map = inferColumns(rows);
      const body = hasHeader ? rows.slice(1) : rows;
      if (map.date == null || (map.amount == null && map.debit == null && map.credit == null)) {
        const inferred = inferColumns(body);
        map = Object.assign({}, inferred, map);
      }
      det = {
        id: 'generic', label: hasHeader ? 'Format générique (colonnes reconnues)' : 'Format générique',
        bank: '', accountHint: '', generic: true,
        mapping: Object.assign({ hasHeader }, map),
      };
      // Mentionne la banque si elle est écrite dans le fichier
      const sniff = B.normalizeText(rows.slice(0, 5).flat().join(' '));
      if (sniff.includes('wealthsimple')) { det.bank = 'Wealthsimple'; det.accountHint = 'Wealthsimple'; det.mapping.hint = 'wealthsimple'; }
    }
    const m = det.mapping;
    if (!m.dateOrder) {
      const body = m.hasHeader ? rows.slice(1) : rows;
      m.dateOrder = B.detectDateOrder(body.map((r) => r[m.date])) || 'MDY';
    }
    det.rows = rows;
    det.signature = sig;
    det.columnCount = Math.max(...rows.slice(0, 50).map((r) => r.length));
    det.header = m.hasHeader ? rows[0] : null;
    return det;
  }

  /** Convertit les lignes en transactions selon la configuration. */
  function applyMapping(rows, m) {
    const body = m.hasHeader ? rows.slice(1) : rows;
    const out = [];
    let skipped = 0;
    const has = (k) => m[k] != null && m[k] > -1;
    body.forEach((r, idx) => {
      const date = has('date') ? B.parseDate(r[m.date], m.dateOrder) : null;
      let amount = null;
      if (has('amount') && !isEmpty(r[m.amount])) amount = B.parseAmount(r[m.amount]);
      else if (has('debit') || has('credit')) {
        const d = has('debit') ? B.parseAmount(r[m.debit]) : null;
        const c = has('credit') ? B.parseAmount(r[m.credit]) : null;
        if (d != null || c != null) amount = (c != null ? Math.abs(c) : 0) - (d != null ? Math.abs(d) : 0);
      }
      if (!date || amount == null) { skipped++; return; }
      if (m.invert) amount = -amount;
      let description = has('description') ? r[m.description] : '';
      const type = has('type') ? r[m.type] : '';
      const subtype = has('subtype') ? r[m.subtype] : '';
      if (!description) description = [type, subtype].filter(Boolean).join(' ') || '(sans description)';
      description = description.replace(/\s+/g, ' ').trim();
      let hint = null;
      if (m.hint === 'wealthsimple') hint = wealthsimpleHint(type) || wealthsimpleHint(subtype);
      out.push({ row: idx, date, description, amount, type, hint });
    });
    return { items: out, skipped };
  }

  /** Clé de dédoublonnage : date + montant + description, avec rang d'occurrence. */
  function dedupeKeys(items) {
    const seen = {};
    return items.map((t) => {
      const base = `${t.date}|${t.amount}|${B.normalizeText(t.description)}`;
      seen[base] = (seen[base] || 0) + 1;
      return `${base}#${seen[base]}`;
    });
  }

  const api = { detect, applyMapping, dedupeKeys, mapHeader, inferColumns, wealthsimpleHint, looksLikeHeader };
  Object.assign(B, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
