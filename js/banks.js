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

  // Indices de classement tirés du relevé --------------------------------------
  // strong : toujours appliqué. bank : passe après les règles de l'utilisateur,
  // avant les mots-clés intégrés. weak : seulement si rien d'autre ne correspond.
  const strong = (categoryId) => ({ categoryId, strong: true });
  const bank = (categoryId) => ({ categoryId, level: 'bank' });
  const weak = (categoryId) => ({ categoryId });

  /** Vers quelle « enveloppe » va un virement entre ses propres comptes, d'après sa note. */
  function potFromNote(note) {
    const n = ' ' + B.normalizeText(note) + ' ';
    if (n.trim() === '') return null;
    if (/ (urgence|urgences|coussin|epargne|epargnes|savings|emergency) /.test(n)) return 'epargne';
    if (/ prevoyance /.test(n)) return 'fond-prevoyance';
    if (/ (celi|celiapp|reer|reee|ferr|tfsa|rrsp|fhsa|resp|placement|placements|investissement|investissements|investir|invest|bourse|fnb|etf) /.test(n)) return 'investissement';
    return null;
  }

  // Codes de la colonne « transaction » des relevés mensuels Wealthsimple.
  function wealthsimpleHint(code) {
    const c = String(code || '').toUpperCase().trim();
    if (!c) return null;
    // Achats et ventes à l'intérieur d'un compte de placement : ce n'est ni un revenu ni une dépense
    if (/^(BUY|SELL|CONT|CONTRIBUTION|DRIP|REINVEST|SPLIT|STKDIS|CRYPTO)/.test(c) || /TRADE/.test(c)) return strong('transferts');
    if (/^(TRFIN|TRFOUT|TRFINTF|TRFOUTTF|TRF|INTERNAL|TRANSFER|WD$|WITHDRAWAL$|DEP$|DEPOSIT$|LOAN|RECALL)/.test(c)) return bank('transferts');
    if (/^(INT|INTEREST|FPLINT)/.test(c)) return strong('interets');
    if (/^(DIV|DIVIDEND|NRT|DISTRIBUTION)/.test(c)) return strong('interets');
    if (/^(FEE|FEES|NRTFEE|FRAIS)/.test(c)) return strong('frais');
    if (/^(REFUND|REIMB|CASHBACK|REWARD|PROMO|BONUS)/.test(c)) return weak('remboursements');
    if (/MONEYMOVEMENT|MONEY MOVEMENT|INSTITUTIONAL/.test(c)) return bank('transferts');
    return null;
  }

  // Catégories données par la banque (carte de crédit Wealthsimple) → catégories de l'application.
  const BANK_CATEGORIES = [
    [/\b(assurance|insurance)/, 'assurances'],
    [/\b(epicerie|grocer)/, 'epicerie'],
    [/\b(restaurant|cafe|coffee|alimentation|food|dining)/, 'restaurants'],
    [/\b(bar|bars|nocturne|nightlife|divertissement|entertainment|activite|loisir|sport|fitness|remise en forme)/, 'loisirs'],
    [/\b(essence|stationnement|peage|transport|taxi|covoiturage|gas|parking|transit|rideshare)/, 'transport'],
    [/\b(internet|telephone|phone|services publics|utilit|facture)/, 'factures'],
    [/\b(abonnement|subscription)/, 'abonnements'],
    [/\b(medical|sante|health|pharmac|dentaire|dental)/, 'sante'],
    [/\b(vol|vols|hotel|voyage|flight|travel|hebergement)/, 'voyages'],
    [/\b(magasinage|vetement|shopping|clothing|electroni)/, 'magasinage'],
    [/\b(education|scolarite|tuition)/, 'education'],
    [/\b(animaux|animal|pets?)\b/, 'animaux'],
    [/\b(cadeau|dons?|gift|charit)/, 'cadeaux'],
    [/\b(frais|fees?)\b/, 'frais'],
  ];
  // Trop vagues pour passer avant les mots-clés (un antirouille et une quincaillerie y sont mêlés).
  const BANK_CATEGORIES_WEAK = [[/\b(maison|entretien|home|maintenance|auto)/, 'autres-depenses']];

  function bankCategoryHint(label) {
    const n = B.normalizeText(label);
    if (!n) return null;
    for (const [re, id] of BANK_CATEGORIES) if (re.test(n)) return bank(id);
    for (const [re, id] of BANK_CATEGORIES_WEAK) if (re.test(n)) return weak(id);
    return null;
  }

  /** Statut d'une ligne : skip (annulée ou refusée), pending (en attente) ou ok. */
  function rowStatus(v) {
    const s = B.normalizeText(v);
    if (!s) return 'ok';
    if (/declin|cancel|annul|fail|echou|reject|rejet|refus|void|expire/.test(s)) return 'skip';
    if (/pending|attente|processing|en cours|authoriz|autoris|hold/.test(s)) return 'pending';
    return 'ok';
  }

  const cell = (r, m, k) => (m[k] != null && m[k] > -1 && r[m[k]] != null ? String(r[m[k]]).trim() : '');
  const withNote = (label, note) => (note ? `${label} · ${note}` : label);
  // Mot-clé de règle tiré d'une note : ses premiers mots
  const noteKey = (note) => (note ? B.normalizeText(note).split(' ').slice(0, 5).join(' ') : null);

  /** Carte de crédit Wealthsimple (credit-card-activities). */
  function wsCardRow(r, m) {
    const typeRaw = cell(r, m, 'type');
    const type = B.normalizeText(typeRaw);
    const merchant = cell(r, m, 'description');
    const note = cell(r, m, 'note');
    const keyDesc = merchant || typeRaw;
    if (type === 'payment' || type === 'paiement') {
      return { description: withNote('Paiement reçu sur la carte', note), keyDesc, noRule: true, hint: strong('transferts') };
    }
    return {
      description: withNote(merchant || typeRaw || '(sans description)', note), keyDesc,
      noRule: !merchant, hint: bankCategoryHint(cell(r, m, 'bankCat')),
    };
  }

  const CARD_PAYEE = /\b(cibc|visa|mastercard|master card|amex|american express|carte de credit|credit card)\b/;

  /** Compte chèques Wealthsimple (chequing-activities). */
  function wsChequingRow(r, m, amount) {
    const typeRaw = cell(r, m, 'type');
    const type = B.normalizeText(typeRaw);
    const subRaw = cell(r, m, 'subtype');
    const sub = B.normalizeText(subRaw);
    const payee = cell(r, m, 'description');
    const note = cell(r, m, 'note');
    const keyDesc = payee || typeRaw;
    const generic = (label, hint) => ({ description: withNote(label, note), keyDesc, ruleKey: noteKey(note), noRule: !note, hint });

    if (type === 'credit card payment') return generic('Paiement de la carte de crédit', strong('transferts'));
    if (type === 'internal transfer') {
      return generic(amount < 0 ? 'Virement interne (sortie)' : 'Virement interne (entrée)', bank(potFromNote(note) || 'transferts'));
    }
    if (type === 'interest') return generic('Intérêts', amount < 0 ? strong('frais') : strong('interets'));
    if (type === 'promotion') return generic('Prime Wealthsimple', bank('autres-revenus'));
    if (payee) {
      // Paiement de facture vers une carte de crédit : c'est un transfert, les achats sont déjà dans le relevé de la carte
      const toCard = sub === 'bill pay' && CARD_PAYEE.test(B.normalizeText(payee));
      return { description: withNote(payee, note), keyDesc, ruleKey: B.normalizeText(payee), hint: toCard ? bank('transferts') : null };
    }
    if (type === 'deposit' && sub === 'cash deposit') return generic('Dépôt en argent', weak('autres-revenus'));
    return generic([typeRaw, subRaw].filter(Boolean).join(' · ') || '(sans description)', null);
  }

  // Formats connus ---------------------------------------------------------

  function detectWealthsimple(rows) {
    const { map, H } = mapHeader(rows[0]);
    const has = (n) => H.includes(n);
    const col = (n) => H.indexOf(n);
    // Carte de crédit : transaction_date, transaction_type, status, merchant, amount, currency, notes, category
    if (has('transaction date') && has('transaction type') && has('merchant') && has('amount')) {
      return {
        id: 'ws-card', label: 'Wealthsimple (carte de crédit)', bank: 'Wealthsimple', accountHint: 'Wealthsimple carte de crédit',
        mapping: { hasHeader: true, date: col('transaction date'), description: col('merchant'), amount: col('amount'),
          type: col('transaction type'), status: col('status'), note: col('notes'), bankCat: col('category'),
          dateOrder: 'YMD', hint: 'ws-card' },
      };
    }
    // Compte chèques : transaction_date, transaction_time, account_number, account_type, transaction_type,
    // transaction_sub_type, status, payee, payee_email, amount, currency, notes
    if (has('transaction date') && has('transaction type') && has('payee') && has('amount')) {
      return {
        id: 'ws-chequing', label: 'Wealthsimple (compte chèques)', bank: 'Wealthsimple', accountHint: 'Wealthsimple compte chèques',
        mapping: { hasHeader: true, date: col('transaction date'), description: col('payee'), amount: col('amount'),
          type: col('transaction type'), subtype: col('transaction sub type'), status: col('status'), note: col('notes'),
          dateOrder: 'YMD', hint: 'ws-chequing' },
      };
    }
    // Relevé mensuel : date, transaction, description, amount, balance(, currency)
    if (has('date') && has('transaction') && has('description') && has('amount')) {
      return {
        id: 'ws-statement', label: 'Wealthsimple (relevé mensuel)', bank: 'Wealthsimple', accountHint: 'Wealthsimple',
        mapping: { hasHeader: true, date: col('date'), description: col('description'),
          amount: col('amount'), type: col('transaction'), hint: 'wealthsimple' },
      };
    }
    // Export d'activités : transaction_date, …, activity_type, activity_sub_type, name, net_cash_amount
    if ((has('transaction date') || has('date')) && has('net cash amount')) {
      return {
        id: 'ws-activities', label: "Wealthsimple (export d'activités)", bank: 'Wealthsimple', accountHint: 'Wealthsimple',
        mapping: { hasHeader: true, date: col(has('transaction date') ? 'transaction date' : 'date'),
          description: col('name') > -1 ? col('name') : (map.description != null ? map.description : null),
          amount: col('net cash amount'), type: col('activity type'), subtype: col('activity sub type'),
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
      if (det) {
        // Format connu : on garde ses colonnes spéciales et on reprend seulement les réglages de l'utilisateur
        det = Object.assign({}, det, { mapping: Object.assign({}, det.mapping, saved, { hint: det.mapping.hint }), remembered: true });
      } else {
        det = { id: 'saved', label: saved.label || 'Format mémorisé', bank: '', accountHint: '', mapping: Object.assign({}, saved), remembered: true };
      }
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

  /**
   * Convertit les lignes en transactions selon la configuration.
   * Chaque transaction : { date, description, amount (cents), hint, keyDesc, ruleKey, noRule, pending }.
   *   keyDesc : texte stable du relevé, utilisé pour reconnaître les doublons ;
   *   ruleKey : mot-clé à retenir si l'utilisateur corrige la catégorie (bénéficiaire ou note) ;
   *   noRule  : libellé trop général pour en tirer une règle (« Virement interne » sans note).
   */
  function applyMapping(rows, m) {
    const body = m.hasHeader ? rows.slice(1) : rows;
    const out = [];
    let skipped = 0, cancelled = 0;
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
      const status = has('status') ? rowStatus(r[m.status]) : 'ok';
      if (status === 'skip') { cancelled++; return; }
      if (m.invert) amount = -amount;
      const type = cell(r, m, 'type');
      let item;
      if (m.hint === 'ws-card') item = wsCardRow(r, m);
      else if (m.hint === 'ws-chequing') item = wsChequingRow(r, m, amount);
      else {
        const subtype = cell(r, m, 'subtype');
        const description = cell(r, m, 'description') || [type, subtype].filter(Boolean).join(' ') || '(sans description)';
        let hint = null;
        if (m.hint === 'wealthsimple') {
          hint = wealthsimpleHint(type) || wealthsimpleHint(subtype);
          // Un virement vers un CELI, un REER ou un compte d'urgence dit où va l'argent
          if (hint && hint.categoryId === 'transferts' && !hint.strong) hint = bank(potFromNote(description) || 'transferts');
        }
        item = { description, hint };
      }
      item.description = item.description.replace(/\s+/g, ' ').trim();
      out.push(Object.assign({ row: idx, date, amount, type, pending: status === 'pending' }, item));
    });
    return { items: out, skipped, cancelled };
  }

  /** Clé de dédoublonnage : date + montant + texte du relevé, avec rang d'occurrence. */
  function dedupeKeys(items) {
    const seen = {};
    return items.map((t) => {
      const base = `${t.date}|${t.amount}|${B.normalizeText(t.keyDesc || t.description)}`;
      seen[base] = (seen[base] || 0) + 1;
      return `${base}#${seen[base]}`;
    });
  }

  const api = { detect, applyMapping, dedupeKeys, mapHeader, inferColumns, wealthsimpleHint, bankCategoryHint, potFromNote, looksLikeHeader };
  Object.assign(B, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
