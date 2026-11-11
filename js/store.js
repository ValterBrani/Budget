/* Enregistrement des données dans le navigateur (localStorage) et utilitaires de dates. */
(function (root) {
  'use strict';
  const B = (root.Budget = root.Budget || {});
  const KEY = 'budget-par-claude-v1';

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultState() {
    return {
      app: 'budget-par-claude',
      version: 1,
      categories: B.DEFAULT_CATEGORIES.map((c) => Object.assign({ budget: 0 }, c)),
      rules: [], // règles apprises : { id, pattern, categoryId }
      accounts: [], // { id, name, bank }
      transactions: [], // { id, date, desc, amount (cents), cat, catSrc, acct, note, key, src }
      profiles: {}, // formats CSV mémorisés
      settings: {},
    };
  }

  function migrate(s) {
    const d = defaultState();
    Object.keys(d).forEach((k) => { if (s[k] == null) s[k] = d[k]; });
    return s;
  }

  function load() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(KEY);
      if (!raw) return defaultState();
      return migrate(JSON.parse(raw));
    } catch (e) {
      console.warn('Lecture des données impossible', e);
      return defaultState();
    }
  }

  function save(state) {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(state, (k, v) => (k.startsWith('_') ? undefined : v)));
      return true;
    } catch (e) {
      console.warn('Enregistrement impossible', e);
      return false;
    }
  }

  function clear() {
    try { root.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  // Dates locales au format AAAA-MM-JJ (sans fuseau horaire)
  const pad = (n) => String(n).padStart(2, '0');
  function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function today() { return ymd(new Date()); }
  function thisMonth() { return today().slice(0, 7); }
  function addDays(date, n) {
    const [y, m, d] = date.split('-').map(Number);
    return ymd(new Date(y, m - 1, d + n));
  }
  function addMonths(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  function toDate(date) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d || 1);
  }

  const api = { KEY, uid, defaultState, migrate, load, save, clear, today, thisMonth, addDays, addMonths, toDate, ymd };
  Object.assign(B, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
