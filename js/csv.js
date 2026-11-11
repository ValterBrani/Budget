/* Lecture de fichiers CSV, montants et dates.
   Aucune dépendance : fonctionne dans le navigateur et dans Node (tests). */
(function (root) {
  'use strict';
  const B = (root.Budget = root.Budget || {});

  /** Minuscules, sans accents, ponctuation remplacée par des espaces. */
  function normalizeText(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9&]+/g, ' ')
      .trim();
  }

  function stripBOM(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  function countOutsideQuotes(line, d) {
    let n = 0, q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === d && !q) n++;
    }
    return n;
  }

  /** Devine le séparateur : virgule, point-virgule ou tabulation. */
  function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 15);
    let best = ',', bestScore = -1;
    for (const d of [',', ';', '\t']) {
      const counts = lines.map((l) => countOutsideQuotes(l, d));
      if (!counts.length) continue;
      const min = Math.min(...counts), max = Math.max(...counts);
      const score = min > 0 ? min * 10 - (max - min) : 0;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  /** Transforme le texte CSV en tableau de lignes (tableaux de cellules). */
  function parseCSV(text, delimiter) {
    text = stripBOM(String(text || ''));
    const d = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === d) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows
      .map((r) => r.map((v) => v.trim()))
      .filter((r) => r.some((v) => v !== ''));
  }

  /**
   * Convertit un montant texte en cents (entier).
   * Gère : "-$37.36", "−37,36 $", "1 234,56", "1,234.56", "(12.50)", "12.50-", "CAD 45".
   * Retourne null si la cellule n'est pas un montant.
   */
  function parseAmount(raw) {
    if (raw == null) return null;
    let s = String(raw).trim();
    if (!s) return null;
    let neg = false;
    s = s.replace(/[−‒–—]/g, '-');
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/\b(CAD|USD|EUR)\b/gi, '').replace(/[$€£\s  ]/g, '');
    if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    else if (s.startsWith('+')) s = s.slice(1);
    if (!/^\d[\d.,]*$/.test(s) && !/^[.,]\d+$/.test(s)) return null;
    const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma > -1) {
      const after = s.length - lastComma - 1;
      const commas = (s.match(/,/g) || []).length;
      s = commas === 1 && after <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    }
    const n = Number(s);
    if (!isFinite(n)) return null;
    const cents = Math.round(n * 100);
    return neg ? -cents : cents;
  }

  const MONTHS = {
    jan: 1, janv: 1, janvier: 1, january: 1,
    feb: 2, fev: 2, fevr: 2, fevrier: 2, february: 2,
    mar: 3, mars: 3, march: 3,
    apr: 4, avr: 4, avril: 4, april: 4,
    may: 5, mai: 5,
    jun: 6, juin: 6, june: 6,
    jul: 7, juil: 7, juillet: 7, july: 7,
    aug: 8, aou: 8, aout: 8, august: 8,
    sep: 9, sept: 9, septembre: 9, september: 9,
    oct: 10, octobre: 10, october: 10,
    nov: 11, novembre: 11, november: 11,
    dec: 12, decembre: 12, december: 12,
  };

  function pad(n) { return String(n).padStart(2, '0'); }

  function validYMD(y, m, d) {
    if (y < 100) y += 2000;
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d > dim) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  /**
   * Convertit une date texte en "AAAA-MM-JJ".
   * order : "MDY" ou "DMY" pour les dates du type 05/11/2026 (ambiguës).
   */
  function parseDate(raw, order) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/);
    if (m) return validYMD(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return validYMD(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:$|\s)/);
    if (m) {
      const a = +m[1], b = +m[2], y = +m[3];
      if (order === 'DMY') return validYMD(y, b, a);
      if (order === 'MDY') return validYMD(y, a, b);
      if (a > 12) return validYMD(y, b, a);
      return validYMD(y, a, b);
    }
    // Avec un nom de mois : "Nov 5, 2026", "5 nov. 2026", "05-Nov-2026"
    const tokens = normalizeText(s).split(' ').filter(Boolean);
    let mon = null, year = null, day = null;
    for (const t of tokens) {
      if (mon == null && MONTHS[t] != null) { mon = MONTHS[t]; continue; }
      if (/^\d{4}$/.test(t) && year == null) { year = +t; continue; }
      if (/^\d{1,2}$/.test(t) && day == null) { day = +t; continue; }
      const m2 = t.match(/^(\d{1,2})(st|nd|rd|th|er|e)$/);
      if (m2 && day == null) day = +m2[1];
    }
    if (mon && day && year) return validYMD(year, mon, day);
    return null;
  }

  /** Pour une colonne de dates ambiguës, détermine l'ordre jour/mois. */
  function detectDateOrder(values) {
    let dmy = false, mdy = false;
    for (const v of values) {
      const m = String(v || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
      if (!m) continue;
      if (+m[1] > 12) dmy = true;
      if (+m[2] > 12) mdy = true;
    }
    if (dmy && !mdy) return 'DMY';
    if (mdy && !dmy) return 'MDY';
    return null;
  }

  /** Décode un ArrayBuffer : UTF-8 si valide, sinon Windows-1252 (fréquent dans les exports bancaires). */
  function decodeBuffer(buf) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(buf);
    }
  }

  const api = { normalizeText, detectDelimiter, parseCSV, parseAmount, parseDate, detectDateOrder, decodeBuffer };
  Object.assign(B, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
