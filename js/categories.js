/* Catégories par défaut, règles intégrées (commerces canadiens et québécois)
   et moteur de catégorisation automatique. */
(function (root) {
  'use strict';
  const B = (root.Budget = root.Budget || {});
  const norm = (s) => B.normalizeText(s);

  // kind : expense (dépense), income (revenu), saving (mise de côté),
  //        invest (investissement), transfer (exclu des totaux)
  const DEFAULT_CATEGORIES = [
    { id: 'logement', name: 'Logement', icon: '🏠', kind: 'expense' },
    { id: 'epicerie', name: 'Épicerie', icon: '🛒', kind: 'expense' },
    { id: 'restaurants', name: 'Restaurants et cafés', icon: '🍽️', kind: 'expense' },
    { id: 'transport', name: 'Transport', icon: '🚗', kind: 'expense' },
    { id: 'factures', name: 'Factures et services', icon: '💡', kind: 'expense' },
    { id: 'abonnements', name: 'Abonnements', icon: '📺', kind: 'expense' },
    { id: 'sante', name: 'Santé', icon: '💊', kind: 'expense' },
    { id: 'magasinage', name: 'Magasinage', icon: '🛍️', kind: 'expense' },
    { id: 'loisirs', name: 'Loisirs', icon: '🎟️', kind: 'expense' },
    { id: 'voyages', name: 'Voyages', icon: '✈️', kind: 'expense' },
    { id: 'assurances', name: 'Assurances', icon: '🛡️', kind: 'expense' },
    { id: 'education', name: 'Éducation', icon: '🎓', kind: 'expense' },
    { id: 'animaux', name: 'Animaux', icon: '🐾', kind: 'expense' },
    { id: 'cadeaux', name: 'Cadeaux et dons', icon: '🎁', kind: 'expense' },
    { id: 'frais', name: 'Frais bancaires', icon: '🧾', kind: 'expense' },
    { id: 'autres-depenses', name: 'Autres dépenses', icon: '📦', kind: 'expense' },
    { id: 'salaire', name: 'Salaire', icon: '💼', kind: 'income' },
    { id: 'gouvernement', name: 'Gouvernement', icon: '🏛️', kind: 'income' },
    { id: 'interets', name: 'Intérêts et dividendes', icon: '📈', kind: 'income' },
    { id: 'remboursements', name: 'Remboursements', icon: '↩️', kind: 'income' },
    { id: 'autres-revenus', name: 'Autres revenus', icon: '💵', kind: 'income' },
    { id: 'fond-prevoyance', name: 'Fond de prévoyance', icon: '☂️', kind: 'saving' },
    { id: 'epargne', name: 'Épargne', icon: '🐷', kind: 'saving' },
    { id: 'investissement', name: 'Investissement', icon: '🌱', kind: 'invest' },
    { id: 'transferts', name: 'Transferts entre comptes', icon: '🔁', kind: 'transfer' },
    { id: 'paye-par-fond', name: 'Payé par le fond de prévoyance', icon: '📤', kind: 'transfer' },
  ];
  // Catégories ajoutées à la version 2 des données (voir store.js)
  const V2_CATEGORY_IDS = ['fond-prevoyance', 'epargne', 'investissement', 'paye-par-fond'];

  // [mot-clé, catégorie]. Le mot-clé doit apparaître au début d'un mot de la description.
  // Le mot-clé le plus long l'emporte (« uber eats » avant « uber »).
  // Une espace à la fin exige le mot complet (« bar » ne doit pas trouver « barbier »).
  const RAW_RULES = {
    epicerie: ['metro', 'super c', 'maxi', 'provigo', 'iga', 'loblaws', 'sobeys', 'costco', 'walmart', 'wal mart',
      'adonis', 'marche', 'no frills', 'food basics', 'farm boy', 't&t', 'superstore', 'freshco', 'save on foods',
      'intermarche', 'avril supermarche', 'rachelle bery', 'fruiterie', 'boucherie', 'boulangerie', 'epicerie',
      'grocery', 'safeway', 'real canadian', 'longo', 'whole foods', 'instacart', 'voila'],
    restaurants: ['tim hortons', 'starbucks', 'mcdonald', 'subway', 'a&w', 'uber eats', 'ubereats', 'doordash',
      'skip the dishes', 'skipthedishes', 'restaurant', 'resto', 'pizza', 'sushi', 'cafe', 'second cup',
      'st hubert', 'sth ', 'benny', 'poulet rouge', 'harvey', 'domino', 'burger', 'bistro', 'brasserie',
      'boston pizza', 'kfc', 'popeyes', 'chipotle', 'thai express', 'thaizone', 'mary brown', 'dairy queen',
      'baton rouge', 'scores', 'cora', 'la cage', 'freshii', 'booster juice', 'van houtte', 'dunkin', 'pub ',
      'wendy', 'ashton', 'chic alors', 'paillard', 'normandin', 'valentine', 'pacini', 'cochon dingue',
      'rotisserie', 'poutine', 'casse croute'],
    transport: ['shell', 'esso', 'petro canada', 'petro can', 'ultramar', 'irving', 'pioneer', 'husky', 'chevron',
      'sonic', 'crevier', 'harnois', 'stm', 'opus', 'exo ', 'rtc ', 'sto ', 'artm', 'ttc', 'presto', 'translink',
      'compass', 'uber', 'lyft', 'taxi', 'communauto', 'bixi', 'stationnement', 'parking', 'impark', 'indigo parc',
      'spaq', 'saaq', 'immatriculation', 'via rail', 'greyhound', 'orleans express', 'canadian tire gas',
      'costco gas', 'costco essence', 'esso circle', 'pneus', 'garage', 'antirouille', 'lave auto', 'car wash',
      'peage', '407 etr', 'ezpass', 'evo car', 'traversier'],
    factures: ['hydro quebec', 'hydro one', 'hydro ottawa', 'bc hydro', 'hydro', 'videotron', 'bell', 'rogers',
      'telus', 'fido', 'koodo', 'virgin plus', 'virgin mobile', 'freedom mobile', 'fizz', 'cogeco', 'eastlink',
      'energir', 'enbridge', 'public mobile', 'chatr', 'lucky mobile', 'ebox', 'distributel', 'teksavvy',
      'oxio', 'fortis', 'epcor', 'atco'],
    abonnements: ['netflix', 'spotify', 'disney plus', 'disneyplus', 'crave', 'prime video', 'amazon prime',
      'amazon ca prime', 'prime member', 'amzn prime', 'apple com bill', 'itunes', 'google storage', 'google one',
      'youtube premium', 'icloud', 'adobe', 'microsoft', 'openai', 'chatgpt', 'claude ai', 'anthropic', 'patreon',
      'audible', 'xbox', 'playstation', 'nintendo', 'paramount', 'tou tv', 'club illico', 'illico', 'dropbox',
      'github', 'duolingo', 'kindle', 'apple music', 'deezer'],
    sante: ['pharmaprix', 'jean coutu', 'familiprix', 'uniprix', 'proxim', 'brunet', 'shoppers drug', 'rexall',
      'pharmac', 'phar ', 'clinique', 'hopital', 'hospital', 'dentist', 'dentaire', 'dental', 'optometr',
      'lunetterie', 'physio', 'chiropr', 'massotherap', 'osteopat', 'psycholog', 'medical', 'medecin'],
    magasinage: ['amazon', 'amzn', 'canadian tire', 'winners', 'simons', 'la baie', 'hudson s bay', 'best buy',
      'ikea', 'dollarama', 'dollar tree', 'home depot', 'rona', 'reno depot', 'canac', 'bmr', 'structube',
      'sail', 'sport expert', 'sports experts', 'decathlon', 'h&m', 'uniqlo', 'old navy', 'gap ', 'aritzia',
      'sephora', 'ebay', 'temu', 'shein', 'etsy', 'aliexpress', 'staples', 'bureau en gros', 'marshalls',
      'homesense', 'renaissance', 'village des valeurs', 'value village', 'lululemon', 'mec ', 'apple store',
      'costco online', 'wayfair', 'jysk', 'linen chest', 'bouclair', 'pet valu', 'archambault', 'renaud bray',
      'indigo books', 'chapters', 'la source', 'visions', 'peavey', 'princess auto', 'michaels', 'omer deserres',
      'last hunt', 'altitude sports', 'sp '],
    loisirs: ['cineplex', 'cinema', 'steam', 'ticketmaster', 'evenko', 'spectacle', 'theatre', 'musee', 'museum',
      'gym', 'energie cardio', 'nautilus', 'goodlife', 'ymca', 'escalade', 'bloc shop', 'golf', 'ski ',
      'tremblant', 'sepaq', 'parcs canada', 'parks canada', 'bowling', 'quilles', 'loto quebec', 'mise o jeu',
      'saq', 'lcbo', 'bar ', 'microbrasserie', 'bieres', 'sqdc'],
    voyages: ['air canada', 'westjet', 'porter', 'air transat', 'transat', 'flair', 'sunwing', 'lufthansa',
      'air france', 'klm', 'british airways', 'turkish airlines', 'airbnb', 'expedia', 'booking com', 'hotel',
      'motel', 'marriott', 'hilton', 'hyatt', 'best western', 'holiday inn', 'vrbo', 'aeroport', 'airport',
      'enterprise rent', 'budget rent', 'hertz', 'avis', 'discount location', 'turo', 'airalo'],
    logement: ['loyer', 'rent ', 'hypothe', 'mortgage', 'mtge', 'frais de condo', 'condo fees', 'copropriete',
      'syndicat', 'taxes municipales', 'taxe municipale', 'taxe scolaire', 'property tax', 'ville de', 'city of',
      'municipalite', 'centris'],
    assurances: ['assurance', 'insurance', 'intact', 'belair', 'la capitale', 'beneva', 'ssq', 'desjardins assurances',
      'td assurance', 'td insurance', 'sonnet', 'promutuel', 'aviva', 'co operators', 'wawanesa',
      'industrielle alliance', 'ia groupe', 'sun life', 'manuvie', 'manulife', 'canada vie', 'canada life'],
    education: ['universite', 'university', 'cegep', 'college', 'ecole', 'tuition', 'scolarite', 'udemy', 'coursera',
      'masterclass', 'librairie'],
    animaux: ['petsmart', 'mondou', 'veterinaire', 'veterinary', 'clinique veterinaire', 'animalerie', 'chico'],
    cadeaux: ['centraide', 'croix rouge', 'red cross', 'donation', 'canadahelps', 'gofundme', 'fondation', 'unicef',
      'oxfam', 'moisson'],
    frais: ['frais mensuels', 'frais de service', 'service charge', 'monthly fee', 'monthly plan fee', 'frais annuels',
      'annual fee', 'interest charge', 'frais d interet', 'interets debiteurs', 'purchase interest', 'overdraft',
      'decouvert', 'nsf', 'frais', 'fee ', 'atm fee', 'frais gab', 'foreign transaction', 'interet', 'interest'],
    salaire: ['payroll', 'paie', 'pay ', 'pay pay', 'salaire', 'salary', 'depot direct', 'direct deposit', 'dep paie',
      'deposit payroll', 'remuneration'],
    gouvernement: ['canada fed', 'gst', 'tps', 'ccb', 'child benefit', 'allocation', 'revenu quebec',
      'gouv du quebec', 'gouvernement', 'retraite quebec', 'service canada', 'rqap', 'qpip', 'cra ', 'arc tps',
      'credit solidarite', 'solidarite', 'prestation', 'ei canada', 'assurance emploi'],
    interets: ['interest', 'interet', 'interets', 'dividend', 'dividende', 'distribution', 'int paid',
      'interet paye', 'interest earned'],
    remboursements: ['refund', 'remboursement', 'cashback', 'cash back', 'remise', 'reversal', 'retour',
      'credit voucher', 'return', 'aga '],
    'fond-prevoyance': ['fond de prevoyance', 'fonds de prevoyance', 'prevoyance'],
    epargne: ['epargne', 'savings', 'tangerine savings', 'compte urgence', 'fonds d urgence', 'fond d urgence',
      'coussin'],
    investissement: ['questrade', 'disnat', 'desjardins courtage', 'courtage', 'qtrade', 'tfsa', 'celi', 'reer',
      'rrsp', 'celiapp', 'fhsa', 'reee', 'resp', 'placement', 'investment', 'investissement',
      'wealthsimple invest', 'wealthsimple trade'],
    transferts: ['payment thank you', 'paiement merci', 'paiemen t merci', 'paiement recu', 'payment received',
      'cibc visa', 'cibc mastercard', 'visa cibc', 'costco cibc', 'cibc costco', 'internet transfer',
      'virement entre comptes', 'virement interne', 'internal transfer', 'transfer to', 'transfer from',
      'transfert de', 'transfert a', 'virement de compte', 'pmt to', 'credit card payment', 'paiement carte',
      'paiement de carte', 'paiement de la carte', 'bill payment visa', 'own account', 'mes comptes',
      'wealthsimple', 'neo financial', 'eq bank', 'koho', 'simplii'],
  };

  const DEFAULT_RULES = [];
  Object.keys(RAW_RULES).forEach((cat) => {
    RAW_RULES[cat].forEach((p, i) => DEFAULT_RULES.push({ id: `d-${cat}-${i}`, pattern: p, categoryId: cat, builtin: true }));
  });

  // Prépare une règle pour la recherche (normalisation mise en cache).
  function prep(rule) {
    if (rule._n == null || rule._p !== rule.pattern) {
      rule._p = rule.pattern;
      rule._n = norm(rule.pattern) + (/\s$/.test(rule.pattern) ? ' ' : '');
    }
    return rule._n;
  }

  /**
   * Trouve la catégorie d'une transaction. Ordre de priorité :
   *   1. indice « strong » du relevé (ex. un paiement de carte est toujours un transfert) ;
   *   2. règles de l'utilisateur ;
   *   3. indice « bank » du relevé (catégorie donnée par la banque, virement interne) ;
   *   4. mots-clés intégrés, le plus long gagne ;
   *   5. indice faible du relevé.
   * hint : { categoryId, strong?, level? } fourni par le lecteur du format bancaire.
   * Une catégorie de revenu n'est jamais appliquée à une sortie d'argent.
   */
  function categorize(description, cents, userRules, catsById, hint) {
    const h = hint && catsById[hint.categoryId] ? hint : null;
    if (h && h.strong) return { categoryId: h.categoryId, source: 'hint' };
    const text = ' ' + norm(description) + ' ';
    const bestOf = (rules) => {
      let best = null, bestScore = -1;
      for (const r of rules) {
        const p = prep(r);
        if (!p || !text.includes(' ' + p)) continue;
        const cat = catsById[r.categoryId];
        if (!cat) continue;
        if (cat.kind === 'income' && cents < 0) continue;
        // À longueur égale, on préfère la catégorie qui va dans le sens du montant
        // (« INTERET » débité = frais ; « INTERET » crédité = revenu d'intérêts).
        const fits = cat.kind === 'income' ? cents > 0 : cat.kind === 'expense' && cents < 0;
        const score = p.length + (fits ? 0.5 : 0);
        if (score > bestScore) { best = r; bestScore = score; }
      }
      return best;
    };
    const user = bestOf(userRules || []);
    if (user) return { categoryId: user.categoryId, source: 'rule', pattern: user.pattern };
    if (h && h.level === 'bank') return { categoryId: h.categoryId, source: 'bank' };
    const builtin = bestOf(DEFAULT_RULES);
    if (builtin) return { categoryId: builtin.categoryId, source: 'builtin', pattern: builtin.pattern };
    if (h) return { categoryId: h.categoryId, source: 'hint' };
    return { categoryId: null, source: 'none' };
  }

  const NOISE = [
    'purchase at', 'refund from', 'direct deposit from', 'interac e transfer to', 'interac e transfer from',
    'point of sale interac retail purchase', 'point of sale visa debit retail purchase', 'interac retail purchase',
    'visa debit retail purchase', 'visa debit purchase', 'retail purchase', 'achat au point de vente', 'achat interac',
    'achat debit', 'paiement direct', 'visa debit', 'interac purchase', 'pre authorized debit', 'preauthorized debit',
    'debit preautorise', 'prelevement automatique', 'internet bill pay', 'paiement de facture', 'paiement facture',
    'electronic funds transfer', 'electronic funds', 'e transfer', 'virement interac', 'purchase', 'achat', 'pos ',
    'aft in', 'aft out', 'spend', 'sq ', 'sp ', 'tst ', 'pp ', 'paypal ',
  ];

  /** Extrait un mot-clé de commerce réutilisable (« metro plus », « netflix »…). */
  function merchantKey(description) {
    let t = ' ' + norm(description) + ' ';
    for (const n of NOISE) {
      const k = ' ' + n.trim() + ' ';
      if (t.startsWith(k)) t = ' ' + t.slice(k.length);
    }
    const words = t.split(' ').filter((w) => w && !/\d/.test(w) && !/^(qc|on|bc|ab|mb|sk|ns|nb|pe|nl|ca|inc|ltee|ltd)$/.test(w));
    while (words.length > 1 && /^(at|de|du|la|le|les|from|to|chez|the)$/.test(words[0])) words.shift();
    if (!words.length) return norm(description).split(' ').slice(0, 2).join(' ');
    if (words[0].length >= 6 || words.length === 1) return words[0];
    return words.slice(0, 2).join(' ');
  }

  /** Vrai si la description contient le mot-clé en début de mot (mot complet si le mot-clé finit par une espace). */
  function matchesKey(description, key) {
    const k = norm(key);
    if (!k) return false;
    return (' ' + norm(description) + ' ').includes(' ' + k + (/\s$/.test(String(key)) ? ' ' : ''));
  }

  const api = { DEFAULT_CATEGORIES, V2_CATEGORY_IDS, DEFAULT_RULES, categorize, merchantKey, matchesKey };
  Object.assign(B, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
