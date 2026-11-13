/* Interface de l'application. */
(function () {
  'use strict';
  const B = window.Budget;
  let S = B.load();

  const ui = {
    view: 'dashboard',
    month: B.thisMonth(),
    filters: { q: '', cat: '', acct: '', type: '', scope: 'month' },
    limit: 200,
    quick: { type: 'expense', text: '', cat: '', catTouched: false, date: B.today(), acct: '' },
    queue: [],
    imp: null,
    newCatIcon: 'tag',
    iconTarget: null,
  };

  // Outils -------------------------------------------------------------------
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
  const money = (c) => fmt.format((c || 0) / 100);
  const signed = (c) => (c > 0 ? '+' : c < 0 ? '−' : '') + fmt.format(Math.abs(c) / 100);
  const monthName = (ym, opts) => B.toDate(ym + '-01').toLocaleDateString('fr-CA', opts || { month: 'long', year: 'numeric' });
  const dayName = (d) => B.toDate(d).toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
  const shortDate = (d) => B.toDate(d).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });

  const catMap = () => Object.fromEntries(S.categories.map((c) => [c.id, c]));
  const acctMap = () => Object.fromEntries(S.accounts.map((a) => [a.id, a]));
  const catOf = (id) => S.categories.find((c) => c.id === id);
  const kindOf = (t) => { const c = catOf(t.cat); return c ? c.kind : t.amount >= 0 ? 'income' : 'expense'; };

  function persist() {
    if (!B.save(S)) toast("Impossible d'enregistrer : l'espace du navigateur est plein. Exporte une sauvegarde depuis Réglages.");
  }

  // inc : revenus, exp : dépenses, sav : mises de côté, inv : investi.
  // cap : capacité d'investir = revenus − dépenses − mises de côté.
  function totals(list) {
    let inc = 0, exp = 0, sav = 0, inv = 0;
    for (const t of list) {
      const k = kindOf(t);
      if (k === 'transfer') continue;
      if (k === 'income') inc += t.amount;
      else if (k === 'saving') sav -= t.amount;
      else if (k === 'invest') inv -= t.amount;
      else exp -= t.amount;
    }
    return { inc, exp, sav, inv, net: inc - exp, cap: inc - exp - sav };
  }
  const inMonth = (ym) => S.transactions.filter((t) => t.date.startsWith(ym));

  function categorize(desc, cents, hint) {
    return B.categorize(desc, cents, S.rules, catMap(), hint);
  }

  // Types de catégories : [identifiant, libellé au singulier, libellé de groupe]
  const KINDS = [
    ['expense', 'Dépense', 'Dépenses'],
    ['income', 'Revenu', 'Revenus'],
    ['saving', 'Mise de côté', 'Mises de côté'],
    ['invest', 'Investissement', 'Investissement'],
    ['transfer', 'Exclue des totaux', 'Exclus des totaux'],
  ];
  const kindOptions = (selected) => KINDS.map(([k, label]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${label}</option>`).join('');
  // Une catégorie convient-elle au sens choisi dans la saisie express (dépense ou revenu) ?
  const fitsType = (c, type) => (type === 'income' ? c.kind === 'income' || c.kind === 'transfer' : c.kind !== 'income');

  function catOptions(selected, opts) {
    opts = opts || {};
    const groups = KINDS.map(([k, , plural]) => [k, plural]);
    let h = opts.noEmpty ? '' : `<option value="">${opts.emptyLabel || 'À catégoriser'}</option>`;
    for (const [k, label] of groups) {
      const cs = S.categories.filter((c) => c.kind === k);
      if (!cs.length) continue;
      h += `<optgroup label="${label}">` + cs.map((c) => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(c.name)}</option>`).join('') + '</optgroup>';
    }
    return h;
  }
  function acctOptions(selected, emptyLabel) {
    return `<option value="">${emptyLabel || 'Aucun compte'}</option>` +
      S.accounts.map((a) => `<option value="${esc(a.id)}"${a.id === selected ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
  }

  // Icônes de l'interface (voir js/icons.js)
  const UI_ICONS = { ok: 'check', warn: 'triangle-alert', over: 'circle-alert', trash: 'trash-2' };
  const icon = (n, cls) => B.icon(UI_ICONS[n] || n, cls);
  /** Pastille avec l'icône d'une catégorie. Sans catégorie : « à classer ». */
  const catIcon = (c) => `<span class="cat-ico ${c ? 'k-' + c.kind : 'k-none'}" aria-hidden="true">${B.icon(c ? c.icon : 'circle-help')}</span>`;

  // Notifications ------------------------------------------------------------
  let toastTimer = null;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : '');
    el.classList.add('is-on');
    // En « popover », la notification passe au-dessus des fenêtres de dialogue ouvertes
    if (el.showPopover) { try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } catch (e) { /* ancien navigateur */ } }
    if (action) $('.toast-btn', el).onclick = () => { action.run(); hideToast(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 9000 : 4500);
  }
  function hideToast() {
    const el = $('#toast');
    el.classList.remove('is-on');
    if (el.hidePopover) { try { el.hidePopover(); } catch (e) { /* déjà fermé */ } }
  }

  // Saisie express -------------------------------------------------------------
  function parseQuick(text) {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    let amount = null, sign = null, date = null;
    const rest = [];
    const today = B.today();
    for (const tok of tokens) {
      const low = B.normalizeText(tok);
      if (amount == null && /^[+-]?\$?\d+(?:[.,]\d{1,2})?\$?$/.test(tok)) {
        if (tok.startsWith('+')) sign = 'income';
        if (tok.startsWith('-')) sign = 'expense';
        amount = Math.abs(B.parseAmount(tok.replace(/^\+/, '')));
        continue;
      }
      if (!date && low === 'hier') { date = B.addDays(today, -1); continue; }
      if (!date && low === 'avant hier') { date = B.addDays(today, -2); continue; }
      if (!date && (low === 'aujourd hui' || low === 'auj')) { date = today; continue; }
      const dm = tok.match(/^(\d{1,2})[/.](\d{1,2})$/);
      if (!date && dm) {
        let d = B.parseDate(`${today.slice(0, 4)}-${dm[2]}-${dm[1]}`);
        if (d && d > today) d = B.parseDate(`${+today.slice(0, 4) - 1}-${dm[2]}-${dm[1]}`);
        if (d) { date = d; continue; }
      }
      rest.push(tok);
    }
    return { amount, sign, date, description: rest.join(' ') };
  }

  function suggestCategory(desc, type) {
    if (!desc) return '';
    const n = ' ' + B.normalizeText(desc) + ' ';
    // Nom de catégorie tapé directement : « 12 épicerie »
    for (const c of S.categories) {
      const words = B.normalizeText(c.name).split(' ').filter((w) => w.length >= 4);
      if (words.some((w) => n.includes(' ' + w)) && fitsType(c, type)) return c.id;
    }
    const r = categorize(desc, type === 'income' ? 1 : -1);
    const c = catOf(r.categoryId);
    if (c && fitsType(c, type)) return c.id;
    return '';
  }

  function quickHTML(secondary) {
    const q = ui.quick;
    return `<section class="quick${secondary ? ' quick-secondary' : ''}" aria-label="Saisie express">
      <form id="quickForm" autocomplete="off" novalidate>
        <div class="quick-row">
          <div class="seg" role="group" aria-label="Type d'opération">
            <button type="button" data-qtype="expense" aria-pressed="${q.type === 'expense'}">Dépense</button>
            <button type="button" data-qtype="income" aria-pressed="${q.type === 'income'}">Revenu</button>
          </div>
          <label class="sr-only" for="quickInput">Montant et description</label>
          <input id="quickInput" class="quick-input" value="${esc(q.text)}" placeholder="45,20 metro" spellcheck="false" enterkeyhint="done">
        </div>
        <div class="quick-details">
          <output id="quickAmount" class="quick-amount" aria-live="polite"></output>
          <label class="field"><span>Catégorie</span><select id="quickCat">${catOptions(q.cat)}</select></label>
          <label class="field"><span>Date</span><input type="date" id="quickDate" value="${esc(q.date)}" max="2100-12-31"></label>
          <label class="field"><span>Compte</span><select id="quickAcct">${acctOptions(q.acct)}</select></label>
          <button type="submit" class="btn btn-light">Ajouter</button>
        </div>
        <p class="quick-hint">Montant puis description. Commence par « + » pour un revenu. Tu peux écrire « hier » ou « 3/11 » pour la date.</p>
      </form>
    </section>`;
  }

  function updateQuickPreview() {
    const q = ui.quick;
    const p = parseQuick(q.text);
    if (p.sign && p.sign !== q.type) { q.type = p.sign; $$('[data-qtype]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.qtype === q.type))); }
    if (p.date) { q.date = p.date; const d = $('#quickDate'); if (d) d.value = p.date; }
    if (!q.catTouched) {
      q.cat = suggestCategory(p.description, q.type);
      const sel = $('#quickCat'); if (sel) sel.value = q.cat;
    }
    const out = $('#quickAmount');
    if (out) {
      out.textContent = p.amount ? (q.type === 'income' ? '+' : '−') + money(p.amount) : '0,00 $';
      out.classList.toggle('is-empty', !p.amount);
    }
  }

  function submitQuick() {
    const q = ui.quick;
    const p = parseQuick(q.text);
    if (!p.amount) { toast('Indique un montant, par exemple « 45,20 metro ».'); $('#quickInput').focus(); return; }
    const c = catOf(q.cat);
    const amount = q.type === 'income' ? p.amount : -p.amount;
    const desc = p.description || (c ? c.name : q.type === 'income' ? 'Revenu' : 'Dépense');
    const tx = { id: B.uid(), date: q.date || B.today(), desc, amount, cat: q.cat || null, catSrc: q.catTouched ? 'user' : 'auto', acct: q.acct || null, note: '', src: 'manual' };
    S.transactions.push(tx);
    // Apprend le commerce si la catégorie a été choisie à la main
    if (q.catTouched && q.cat && p.description) learnRule(p.description, q.cat, true);
    persist();
    q.text = ''; q.catTouched = false; q.cat = ''; q.type = 'expense';
    toast(`Ajouté : ${desc}, ${signed(amount)}${c ? ' dans ' + c.name : ''}.`, { label: 'Annuler', run: () => { S.transactions = S.transactions.filter((t) => t.id !== tx.id); persist(); render(); } });
    if (!tx.date.startsWith(ui.month) && ui.view !== 'transactions') ui.month = tx.date.slice(0, 7);
    render();
    const input = $('#quickInput'); if (input) input.focus();
  }

  /**
   * Crée une règle « mot-clé → catégorie » si les règles actuelles ne donnent pas déjà ce résultat.
   * opts : { rk (mot-clé fourni par le relevé), noRule, hint, amount } pour une opération importée.
   */
  function learnRule(description, categoryId, silent, opts) {
    opts = opts || {};
    if (opts.noRule) return null;
    // Un mot-clé fourni par le relevé (bénéficiaire, note) doit correspondre au mot complet
    const pattern = opts.rk ? opts.rk + ' ' : B.merchantKey(description);
    const key = B.normalizeText(pattern);
    if (!key || key.length < 3) return null;
    const c = catOf(categoryId);
    const sign = opts.amount != null ? opts.amount : c && c.kind === 'income' ? 1 : -1;
    if (categorize(description, sign, opts.hint).categoryId === categoryId) return null;
    const existing = S.rules.find((r) => B.normalizeText(r.pattern) === key);
    if (existing) existing.categoryId = categoryId;
    else S.rules.push({ id: B.uid(), pattern, categoryId });
    if (!silent) persist();
    return key;
  }

  // Vues -----------------------------------------------------------------------
  function render() {
    $$('.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.view === ui.view ? 'page' : 'false'));
    const monthNav = $('.month-nav');
    monthNav.hidden = ui.view === 'settings';
    $('#monthLabel').textContent = monthName(ui.month);
    $('[data-action="next-month"]').disabled = ui.month >= B.addMonths(B.thisMonth(), 1);
    const main = $('#main');
    const hadQuickFocus = document.activeElement && document.activeElement.id === 'quickInput';
    const views = { dashboard: viewDashboard, transactions: viewTransactions, budgets: viewBudgets, settings: viewSettings };
    main.innerHTML = views[ui.view]();
    if (ui.view === 'dashboard') drawChart();
    if ($('#quickInput')) {
      updateQuickPreview();
      if (hadQuickFocus) { const i = $('#quickInput'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    }
  }

  function summaryHTML(list) {
    const t = totals(list);
    const budgets = S.categories.filter((c) => c.kind === 'expense' && c.budget > 0);
    const budgetTotal = budgets.reduce((a, c) => a + c.budget, 0);
    let budgetLine = '';
    if (budgetTotal) {
      const spent = budgets.reduce((a, c) => a + spentIn(list, c.id), 0);
      const left = budgetTotal - spent;
      budgetLine = `<div class="sum-item"><span class="sum-label">Budget du mois</span>
        <span class="sum-value">${money(Math.abs(left))}</span>
        <span class="sum-note">${left >= 0 ? 'encore disponibles' : 'de dépassement'} sur ${money(budgetTotal)}</span></div>`;
    }
    let capNote;
    if (t.inc <= 0) capNote = 'aucun revenu ce mois-ci';
    else if (t.cap < 0) capNote = t.sav > 0 ? 'tes dépenses et tes mises de côté dépassent tes revenus' : 'tu dépenses plus que tu ne gagnes';
    else if (t.inv > 0) capNote = t.cap >= t.inv ? `${money(t.inv)} investis, ${money(t.cap - t.inv)} encore disponibles` : `${money(t.inv)} investis, ${money(t.inv - t.cap)} de plus que ta capacité`;
    else capNote = `${Math.round((t.cap / t.inc) * 100)} % de tes revenus, rien d'investi ce mois-ci`;
    return `<section class="summary" aria-label="Résumé du mois">
      <div class="sum-item"><span class="sum-label">Revenus</span><span class="sum-value">${money(t.inc)}</span></div>
      <div class="sum-item"><span class="sum-label">Dépenses</span><span class="sum-value">${money(t.exp)}</span></div>
      ${t.sav !== 0 ? `<div class="sum-item"><span class="sum-label">Mis de côté</span><span class="sum-value">${money(t.sav)}</span></div>` : ''}
      <div class="sum-item sum-net"><span class="sum-label">Capacité d'investir</span><span class="sum-value ${t.cap >= 0 ? 'pos' : 'neg'}">${signed(t.cap)}</span>
        <span class="sum-note">${capNote}</span></div>
      ${budgetLine}
    </section>`;
  }

  function spentIn(list, catId) {
    return list.reduce((a, t) => (t.cat === catId ? a - t.amount : a), 0);
  }

  function emptyHTML() {
    return `<section class="empty">
      <h2>Ton budget commence ici</h2>
      <p>Note une dépense dans la barre ci-dessus, ou importe un relevé CSV de ta banque. CIBC et Wealthsimple sont reconnus automatiquement, les autres banques aussi la plupart du temps.</p>
      <div class="btn-row">
        <button class="btn btn-primary" data-action="open-import">Importer un relevé CSV</button>
        <button class="btn" data-action="load-demo">Essayer avec des données d'exemple</button>
      </div>
      <p class="muted small">Tes données restent dans ce navigateur. Rien n'est envoyé sur Internet.</p>
    </section>`;
  }

  function envelopesHTML(list) {
    const rows = S.categories.filter((c) => c.kind === 'expense').map((c) => ({ c, spent: spentIn(list, c.id) }))
      .filter((r) => r.spent > 0 || r.c.budget > 0)
      .sort((a, b) => b.spent - a.spent);
    const uncategorized = list.filter((t) => !t.cat && t.amount < 0).reduce((a, t) => a - t.amount, 0);
    const pots = S.categories.filter((c) => c.kind === 'saving' || c.kind === 'invest').map((c) => ({ c, v: spentIn(list, c.id) })).filter((r) => r.v !== 0);
    const potsHTML = pots.length ? `<h3 class="sub">Mis de côté et investi</h3><ul class="pots">${pots.map(({ c, v }) => `<li><span class="env-name">${catIcon(c)}${esc(c.name)}</span><b class="num">${money(v)}</b></li>`).join('')}</ul>` : '';
    if (!rows.length && !uncategorized) return '<p class="muted">Aucune dépense ce mois-ci.</p>' + potsHTML;
    const maxSpent = Math.max(...rows.map((r) => r.spent), uncategorized, 1);
    const li = rows.map(({ c, spent }) => {
      let bar, status;
      if (c.budget > 0) {
        const pct = spent / c.budget;
        const st = pct > 1 ? 'over' : pct >= 0.85 ? 'warn' : 'ok';
        bar = `<div class="bar" role="img" aria-label="${Math.round(pct * 100)} % du budget"><span class="bar-fill st-${st}" style="width:${Math.min(100, pct * 100)}%"></span></div>`;
        const left = c.budget - spent;
        status = `<span class="env-status st-${st}">${icon(st === 'over' ? 'over' : st === 'warn' ? 'warn' : 'ok')}${st === 'over' ? `Dépassé de ${money(-left)}` : `Reste ${money(left)}`}</span>`;
      } else {
        bar = `<div class="bar bar-plain"><span class="bar-fill" style="width:${(spent / maxSpent) * 100}%"></span></div>`;
        status = `<button class="link small" data-action="go" data-to="budgets">Fixer un budget</button>`;
      }
      return `<li class="env">
        <div class="env-top"><span class="env-name">${catIcon(c)}${esc(c.name)}</span>
          <span class="env-amt"><b>${money(spent)}</b>${c.budget > 0 ? ` <span class="muted">sur ${money(c.budget)}</span>` : ''}</span></div>
        ${bar}<div class="env-foot">${status}</div></li>`;
    }).join('');
    const unc = uncategorized ? `<li class="env env-unc"><div class="env-top"><span class="env-name">${catIcon(null)}À catégoriser</span><span class="env-amt"><b>${money(uncategorized)}</b></span></div>
      <div class="bar bar-plain"><span class="bar-fill" style="width:${(uncategorized / maxSpent) * 100}%"></span></div>
      <div class="env-foot"><button class="link small" data-action="show-uncat">Classer ces dépenses</button></div></li>` : '';
    return `<ul class="envelopes">${li}${unc}</ul>${potsHTML}`;
  }

  function chartData() {
    const data = [];
    for (let i = 5; i >= 0; i--) {
      const ym = B.addMonths(ui.month, -i);
      const t = totals(inMonth(ym));
      data.push({ ym, label: monthName(ym, { month: 'short' }).replace('.', ''), longLabel: monthName(ym), income: Math.max(0, t.inc), expense: Math.max(0, t.exp) });
    }
    return data;
  }
  function drawChart() {
    const el = $('#chart');
    if (el) B.monthlyChart(el, chartData(), money);
  }

  function viewDashboard() {
    const list = inMonth(ui.month);
    const any = S.transactions.length > 0;
    const uncat = list.filter((t) => !t.cat).length;
    const recent = [...list].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 6);
    const data = chartData();
    return `${quickHTML()}
      ${any ? summaryHTML(list) : ''}
      ${!any ? emptyHTML() : ''}
      ${uncat ? `<div class="notice"><span>${uncat} opération${uncat > 1 ? 's' : ''} à catégoriser ce mois-ci.</span><button class="btn btn-small" data-action="show-uncat">Les classer</button></div>` : ''}
      ${any ? `<div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>Enveloppes</h2><button class="link small" data-action="go" data-to="budgets">Modifier les budgets</button></div>${envelopesHTML(list)}</section>
        <section class="panel"><div class="panel-head"><h2>Revenus et dépenses</h2><span class="muted small">6 derniers mois</span></div>
          <div class="legend"><span><i class="sw sw-inc"></i>Revenus</span><span><i class="sw sw-exp"></i>Dépenses</span></div>
          <div id="chart" class="chart"></div>
          <details class="chart-table"><summary>Voir les chiffres</summary>
            <table><thead><tr><th>Mois</th><th class="num">Revenus</th><th class="num">Dépenses</th><th class="num">Solde</th></tr></thead>
            <tbody>${data.map((d) => `<tr><td>${esc(d.longLabel)}</td><td class="num">${money(d.income)}</td><td class="num">${money(d.expense)}</td><td class="num">${signed(d.income - d.expense)}</td></tr>`).join('')}</tbody></table>
          </details>
        </section>
      </div>
      <section class="panel"><div class="panel-head"><h2>Dernières opérations</h2><button class="link small" data-action="go" data-to="transactions">Tout voir</button></div>
        ${recent.length ? `<ul class="txlist">${recent.map(txRow).join('')}</ul>` : '<p class="muted">Rien ce mois-ci pour l\'instant.</p>'}
      </section>` : ''}`;
  }

  function txRow(t) {
    const a = S.accounts.find((x) => x.id === t.acct);
    const k = kindOf(t);
    return `<li class="tx${t.cat ? '' : ' is-uncat'}" data-id="${esc(t.id)}">
      ${catIcon(catOf(t.cat))}
      <div class="tx-main">
        <button type="button" class="tx-desc" data-action="edit-tx" title="Modifier">${esc(t.desc)}</button>
        <span class="tx-meta">${shortDate(t.date)}${a ? ', ' + esc(a.name) : ''}${t.note ? ', ' + esc(t.note) : ''}</span>
      </div>
      <select class="tx-cat" data-action="set-cat" aria-label="Catégorie de ${esc(t.desc)}">${catOptions(t.cat)}</select>
      <span class="tx-amt ${t.amount > 0 ? 'pos' : ''}${k === 'transfer' ? ' is-transfer' : ''}">${signed(t.amount)}</span>
    </li>`;
  }

  function filteredTx() {
    const f = ui.filters;
    const q = B.normalizeText(f.q);
    return S.transactions.filter((t) => {
      if (f.scope === 'month' && !t.date.startsWith(ui.month)) return false;
      if (f.cat === '__none') { if (t.cat) return false; } else if (f.cat && t.cat !== f.cat) return false;
      if (f.acct && t.acct !== f.acct) return false;
      if (f.type && kindOf(t) !== f.type) return false;
      if (q && !B.normalizeText(t.desc + ' ' + (t.note || '')).includes(q)) return false;
      return true;
    }).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  }

  function viewTransactions() {
    const f = ui.filters;
    const list = filteredTx();
    const t = totals(list);
    const shown = list.slice(0, ui.limit);
    let lastDate = '', body = '';
    for (const tx of shown) {
      if (tx.date !== lastDate) {
        if (lastDate) body += '</ul>';
        body += `<h3 class="day">${dayName(tx.date)}</h3><ul class="txlist">`;
        lastDate = tx.date;
      }
      body += txRow(tx);
    }
    if (lastDate) body += '</ul>';
    return `${quickHTML(true)}
      <section class="panel">
        <div class="filters" role="search">
          <label class="field grow"><span>Rechercher</span><input type="search" id="fQ" value="${esc(f.q)}" placeholder="metro, netflix…"></label>
          <label class="field"><span>Catégorie</span><select id="fCat"><option value="">Toutes</option><option value="__none"${f.cat === '__none' ? ' selected' : ''}>À catégoriser</option>${catOptions(f.cat, { noEmpty: true })}</select></label>
          <label class="field"><span>Compte</span><select id="fAcct">${acctOptions(f.acct, 'Tous')}</select></label>
          <label class="field"><span>Type</span><select id="fType">
            <option value="">Tous</option>${KINDS.map(([k, , plural]) => `<option value="${k}"${f.type === k ? ' selected' : ''}>${plural}</option>`).join('')}</select></label>
          <label class="field"><span>Période</span><select id="fScope">
            <option value="month"${f.scope === 'month' ? ' selected' : ''}>${esc(monthName(ui.month))}</option>
            <option value="all"${f.scope === 'all' ? ' selected' : ''}>Tout l'historique</option></select></label>
        </div>
        <p class="result-line">${list.length} opération${list.length > 1 ? 's' : ''}. Revenus ${money(t.inc)}, dépenses ${money(t.exp)}${t.sav ? `, mis de côté ${money(t.sav)}` : ''}${t.inv ? `, investi ${money(t.inv)}` : ''}.
          ${f.q || f.cat || f.acct || f.type ? '<button class="link" data-action="clear-filters">Effacer les filtres</button>' : ''}</p>
        ${list.length ? body : `<p class="muted">Aucune opération ne correspond. ${S.transactions.length ? '' : 'Ajoute une dépense ci-dessus ou importe un relevé.'}</p>`}
        ${list.length > ui.limit ? `<button class="btn" data-action="more">Afficher ${Math.min(200, list.length - ui.limit)} de plus</button>` : ''}
      </section>`;
  }

  function avgSpent(catId, months) {
    let sum = 0;
    for (let i = 1; i <= months; i++) sum += spentIn(inMonth(B.addMonths(ui.month, -i)), catId);
    return Math.round(sum / months);
  }

  function viewBudgets() {
    const list = inMonth(ui.month);
    const cats = S.categories.filter((c) => c.kind === 'expense');
    const total = cats.reduce((a, c) => a + (c.budget || 0), 0);
    let incAvg = 0;
    for (let i = 1; i <= 3; i++) incAvg += totals(inMonth(B.addMonths(ui.month, -i))).inc;
    incAvg = Math.round(incAvg / 3);
    return `<section class="panel">
      <div class="panel-head"><h2>Budgets mensuels</h2><button class="btn btn-small" data-action="suggest-budgets">Proposer selon mes 3 derniers mois</button></div>
      <p class="muted">Un montant par catégorie, chaque mois. Laisse 0 pour une catégorie que tu ne veux pas limiter.</p>
      <table class="budget-table">
        <thead><tr><th>Catégorie</th><th class="num">Moyenne 3 mois</th><th class="num">${esc(monthName(ui.month, { month: 'long' }))}</th><th class="num">Budget</th></tr></thead>
        <tbody>${cats.map((c) => `<tr>
          <td><span class="env-name">${catIcon(c)}${esc(c.name)}</span></td>
          <td class="num muted">${money(avgSpent(c.id, 3))}</td>
          <td class="num">${money(spentIn(list, c.id))}</td>
          <td class="num"><label class="sr-only" for="b-${esc(c.id)}">Budget ${esc(c.name)}</label>
            <input class="money-input" id="b-${esc(c.id)}" data-budget="${esc(c.id)}" inputmode="decimal" value="${c.budget ? (c.budget / 100).toLocaleString('fr-CA', { maximumFractionDigits: 2 }) : ''}" placeholder="0"></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><th>Total</th><td></td><td class="num">${money(cats.reduce((a, c) => a + spentIn(list, c.id), 0))}</td><td class="num"><b>${money(total)}</b></td></tr></tfoot>
      </table>
      ${incAvg ? `<p class="result-line">Tes revenus des 3 derniers mois : ${money(incAvg)} en moyenne. ${total ? (incAvg - total >= 0 ? `Il reste ${money(incAvg - total)} non budgétés pour l'épargne et les imprévus.` : `Tes budgets dépassent tes revenus de ${money(total - incAvg)}.`) : ''}</p>` : ''}
    </section>`;
  }

  function viewSettings() {
    const counts = {};
    S.transactions.forEach((t) => { if (t.acct) counts[t.acct] = (counts[t.acct] || 0) + 1; });
    const hasDemo = S.transactions.some((t) => t.src === 'demo');
    return `<section class="panel">
        <h2>Comptes</h2>
        ${S.accounts.length ? `<ul class="set-list">${S.accounts.map((a) => `<li>
          <label class="sr-only" for="acc-${esc(a.id)}">Nom du compte</label>
          <input id="acc-${esc(a.id)}" data-acct-name="${esc(a.id)}" value="${esc(a.name)}">
          <span class="muted small">${counts[a.id] || 0} opération${(counts[a.id] || 0) > 1 ? 's' : ''}</span>
          <button class="icon-btn" data-action="del-acct" data-id="${esc(a.id)}" aria-label="Supprimer le compte ${esc(a.name)}">${icon('trash')}</button></li>`).join('')}</ul>`
          : '<p class="muted">Les comptes sont créés quand tu importes un relevé.</p>'}
        <form class="inline-form" data-form="add-acct"><label class="field grow"><span>Nouveau compte</span><input name="name" placeholder="Desjardins chèques" required></label><button class="btn">Ajouter</button></form>
      </section>
      <section class="panel">
        <h2>Catégories</h2>
        <p class="muted">Une mise de côté (fond de prévoyance, épargne) réduit ta capacité d'investir sans compter comme une dépense. Un investissement est comparé à cette capacité. Une catégorie exclue des totaux n'est ni un revenu ni une dépense : virements entre tes comptes, paiements de carte.</p>
        <ul class="set-list">${S.categories.map((c) => `<li>
          <button type="button" class="icon-pick" data-action="pick-icon" data-target="${esc(c.id)}" aria-label="Changer l'icône de ${esc(c.name)}" title="Changer l'icône">${B.icon(c.icon)}</button>
          <label class="sr-only" for="cn-${esc(c.id)}">Nom</label><input id="cn-${esc(c.id)}" data-cat-name="${esc(c.id)}" value="${esc(c.name)}">
          <label class="sr-only" for="ck-${esc(c.id)}">Type</label><select id="ck-${esc(c.id)}" data-cat-kind="${esc(c.id)}">
            ${kindOptions(c.kind)}</select>
          <button class="icon-btn" data-action="del-cat" data-id="${esc(c.id)}" aria-label="Supprimer la catégorie ${esc(c.name)}">${icon('trash')}</button></li>`).join('')}</ul>
        <form class="inline-form" data-form="add-cat">
          <div class="field field-icon"><span>Icône</span><button type="button" class="icon-pick" id="newCatIcon" data-action="pick-icon" data-target="__new" aria-label="Choisir l'icône de la nouvelle catégorie" title="Choisir l'icône">${B.icon(ui.newCatIcon)}</button></div>
          <label class="field grow"><span>Nouvelle catégorie</span><input name="name" placeholder="Garderie" required></label>
          <label class="field"><span>Type</span><select name="kind">${kindOptions('expense')}</select></label>
          <button class="btn">Ajouter</button></form>
      </section>
      <section class="panel">
        <h2>Règles de classement</h2>
        <p class="muted">Quand une description contient le mot-clé, l'opération va dans la catégorie. L'app ajoute une règle chaque fois que tu corriges une catégorie. Elle reconnaît aussi d'office ${B.DEFAULT_RULES.length} mots-clés de commerces et d'organismes canadiens.</p>
        ${S.rules.length ? `<ul class="set-list">${S.rules.map((r) => `<li>
          <label class="sr-only" for="rp-${esc(r.id)}">Mot-clé</label><input id="rp-${esc(r.id)}" data-rule-pattern="${esc(r.id)}" value="${esc(r.pattern)}">
          <label class="sr-only" for="rc-${esc(r.id)}">Catégorie</label><select id="rc-${esc(r.id)}" data-rule-cat="${esc(r.id)}">${catOptions(r.categoryId)}</select>
          <button class="icon-btn" data-action="del-rule" data-id="${esc(r.id)}" aria-label="Supprimer la règle ${esc(r.pattern)}">${icon('trash')}</button></li>`).join('')}</ul>` : '<p class="muted small">Aucune règle personnelle pour l\'instant.</p>'}
        <form class="inline-form" data-form="add-rule">
          <label class="field grow"><span>Mot-clé</span><input name="pattern" placeholder="garderie les petits" required></label>
          <label class="field"><span>Catégorie</span><select name="cat" required>${catOptions('')}</select></label>
          <button class="btn">Ajouter</button></form>
        <button class="btn" data-action="reapply-rules">Reclasser les opérations selon les règles</button>
      </section>
      <section class="panel">
        <h2>Données</h2>
        <p class="muted">Tout est enregistré dans ce navigateur, sur cet appareil. Rien n'est envoyé sur Internet. Exporte une sauvegarde de temps en temps, et pour passer à un autre appareil.</p>
        <div class="btn-row">
          <button class="btn btn-primary" data-action="export-json">Exporter une sauvegarde</button>
          <label class="btn">Restaurer une sauvegarde<input type="file" accept=".json,application/json" id="restoreFile" hidden></label>
          <button class="btn" data-action="export-csv">Exporter les opérations en CSV</button>
        </div>
        <div class="btn-row">
          ${hasDemo ? '<button class="btn" data-action="remove-demo">Retirer les données d\'exemple</button>' : '<button class="btn" data-action="load-demo">Charger des données d\'exemple</button>'}
          <button class="btn btn-danger" data-action="wipe">Tout effacer</button>
        </div>
      </section>`;
  }

  // Choix de l'icône d'une catégorie -------------------------------------------------
  function openIconPicker(target) {
    ui.iconTarget = target;
    const current = target === '__new' ? ui.newCatIcon : (catOf(target) || {}).icon;
    const dlg = $('#iconDlg');
    dlg.innerHTML = `<div class="dlg dlg-icons">
      <h2>Choisir une icône</h2>
      ${B.ICON_GROUPS.map(([title, items]) => `<h3 class="icon-group">${esc(title)}</h3>
        <div class="icon-grid">${items.map(([name, label]) => `<button type="button" class="icon-choice" data-action="choose-icon" data-icon="${name}" aria-pressed="${name === current}" aria-label="${esc(label)}" title="${esc(label)}">${B.icon(name)}</button>`).join('')}</div>`).join('')}
      <div class="dlg-foot"><span class="grow"></span><button type="button" class="btn" data-action="close-dlg">Annuler</button></div>
    </div>`;
    dlg.showModal();
    const on = dlg.querySelector('[aria-pressed="true"]');
    if (on) on.focus();
  }

  function chooseIcon(name) {
    if (!B.ICONS[name]) return;
    $('#iconDlg').close();
    if (ui.iconTarget === '__new') {
      ui.newCatIcon = name;
      const b = $('#newCatIcon');
      if (b) { b.innerHTML = B.icon(name); b.focus(); }
      return;
    }
    const c = catOf(ui.iconTarget);
    if (!c) return;
    c.icon = name;
    persist();
    render();
  }

  // Modification d'une opération -------------------------------------------------
  function openEdit(id) {
    const t = S.transactions.find((x) => x.id === id);
    if (!t) return;
    const dlg = $('#editDlg');
    dlg.innerHTML = `<form method="dialog" class="dlg" id="editForm">
      <h2>Modifier l'opération</h2>
      <label class="field"><span>Description</span><input name="desc" value="${esc(t.desc)}" required></label>
      <div class="field-row">
        <label class="field"><span>Montant</span><input name="amount" inputmode="decimal" value="${esc((Math.abs(t.amount) / 100).toLocaleString('fr-CA', { minimumFractionDigits: 2 }))}" required></label>
        <label class="field"><span>Sens</span><select name="dir"><option value="out"${t.amount <= 0 ? ' selected' : ''}>Sortie d'argent</option><option value="in"${t.amount > 0 ? ' selected' : ''}>Entrée d'argent</option></select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Date</span><input type="date" name="date" value="${esc(t.date)}" required></label>
        <label class="field"><span>Compte</span><select name="acct">${acctOptions(t.acct)}</select></label>
      </div>
      <label class="field"><span>Catégorie</span><select name="cat">${catOptions(t.cat)}</select></label>
      <label class="field"><span>Note</span><input name="note" value="${esc(t.note || '')}" placeholder="facultatif"></label>
      <div class="dlg-foot">
        <button type="button" class="btn btn-danger" data-action="delete-tx" data-id="${esc(t.id)}">Supprimer</button>
        <span class="grow"></span>
        <button type="button" class="btn" data-action="close-dlg">Annuler</button>
        <button type="submit" class="btn btn-primary" value="save">Enregistrer</button>
      </div></form>`;
    dlg.dataset.id = id;
    dlg.showModal();
  }

  function saveEdit(form) {
    const t = S.transactions.find((x) => x.id === $('#editDlg').dataset.id);
    if (!t) return;
    const fd = new FormData(form);
    const amt = B.parseAmount(fd.get('amount'));
    const date = B.parseDate(fd.get('date'));
    if (amt == null || !date) { toast('Vérifie le montant et la date.'); return false; }
    const newCat = fd.get('cat') || null;
    if (newCat !== t.cat) t.catSrc = 'user';
    Object.assign(t, { desc: String(fd.get('desc')).trim() || t.desc, amount: fd.get('dir') === 'in' ? Math.abs(amt) : -Math.abs(amt), date, acct: fd.get('acct') || null, cat: newCat, note: String(fd.get('note') || '').trim() });
    persist();
    render();
    return true;
  }

  /** Après un changement manuel de catégorie : propose d'appliquer aux opérations semblables. */
  function afterCategoryChange(t) {
    if (!t.cat) return;
    const c = catOf(t.cat);
    const pattern = t.noRule ? '' : t.rk ? t.rk + ' ' : B.merchantKey(t.desc);
    const key = B.normalizeText(pattern);
    // Libellé trop général (« Virement interne » sans note) : on ne généralise pas
    if (key.length < 3) { toast(`${t.desc} est maintenant dans ${c.name}.`); return; }
    const similar = S.transactions.filter((x) => x.id !== t.id && x.cat !== t.cat && x.catSrc !== 'user' && !x.noRule && B.matchesKey(x.desc, pattern));
    const label = similar.length ? `Classer aussi ${similar.length} autre${similar.length > 1 ? 's' : ''} « ${key} »` : `Retenir « ${key} »`;
    toast(`${t.desc} est maintenant dans ${c.name}.`, {
      label,
      run: () => {
        learnRule(t.desc, t.cat, true, { rk: t.rk, hint: t.hint, amount: t.amount });
        similar.forEach((x) => { x.cat = t.cat; x.catSrc = 'auto'; });
        persist();
        render();
        toast(similar.length ? `${similar.length} opération${similar.length > 1 ? 's' : ''} reclassée${similar.length > 1 ? 's' : ''}. Les prochaines suivront.` : `Les prochaines opérations « ${key} » iront dans ${c.name}.`);
      },
    });
  }

  // Import CSV -----------------------------------------------------------------
  async function startImport(files) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) { ui.imp = null; ui.queue = []; renderImport(); openImportDlg(); return; }
    ui.queue = list;
    await nextImport();
  }

  function openImportDlg() {
    const dlg = $('#importDlg');
    if (!dlg.open) dlg.showModal();
  }

  async function nextImport() {
    const file = ui.queue.shift();
    if (!file) { ui.imp = null; $('#importDlg').close(); return; }
    if (!/\.(csv|txt|tsv)$/i.test(file.name) && !/csv|text/.test(file.type)) {
      toast(`« ${file.name} » n'est pas un fichier CSV. Exporte ton relevé au format CSV depuis le site de ta banque.`);
      return nextImport();
    }
    const text = B.decodeBuffer(await file.arrayBuffer());
    const det = B.detect(text, S.profiles);
    if (det.error) { toast(`${file.name} : ${det.error}`); return nextImport(); }
    // Compte proposé : un compte existant du même nom, sinon un nouveau
    // Compte proposé : même nom que la banque détectée, sinon le compte utilisé la dernière fois pour ce format
    const byHint = S.accounts.find((a) => det.accountHint && B.normalizeText(a.name) === B.normalizeText(det.accountHint));
    const memo = (S.settings.acctBySig || {})[det.signature + '|' + (det.accountHint || '')];
    const bySig = S.accounts.find((a) => a.id === memo);
    const existing = byHint || bySig;
    ui.imp = { fileName: file.name, det, mapping: Object.assign({}, det.mapping), changed: false, acct: existing ? existing.id : '__new', newName: det.accountHint || file.name.replace(/\.[^.]+$/, ''), learn: {}, total: ui.queue.length };
    buildPreview();
    renderImport();
    openImportDlg();
  }

  function buildPreview() {
    const imp = ui.imp;
    const { items, skipped, cancelled } = B.applyMapping(imp.det.rows, imp.mapping);
    const keys = B.dedupeKeys(items);
    const existingKeys = new Set(S.transactions.map((t) => t.key).filter(Boolean));
    const manual = S.transactions.filter((t) => t.src === 'manual');
    imp.items = items.map((it, i) => {
      const dup = existingKeys.has(keys[i]);
      const near = !dup && manual.find((t) => t.amount === it.amount && Math.abs(B.toDate(t.date) - B.toDate(it.date)) <= 3 * 864e5);
      const r = categorize(it.description, it.amount, it.hint);
      return Object.assign(it, { key: keys[i], dup, near: near || null, cat: r.categoryId || '', touched: false, on: !dup && !near && !it.pending });
    });
    imp.skipped = skipped;
    imp.cancelled = cancelled || 0;
  }

  function colOptions(selected, allowNone) {
    const det = ui.imp.det;
    const sample = det.rows[ui.imp.mapping.hasHeader ? 1 : 0] || [];
    let h = allowNone ? `<option value="-1"${selected == null || selected < 0 ? ' selected' : ''}>Aucune</option>` : '';
    for (let i = 0; i < det.columnCount; i++) {
      const name = ui.imp.mapping.hasHeader && det.rows[0][i] ? det.rows[0][i] : `Colonne ${i + 1}`;
      const ex = sample[i] ? ` (ex. ${String(sample[i]).slice(0, 24)})` : '';
      h += `<option value="${i}"${selected === i ? ' selected' : ''}>${esc(name + ex)}</option>`;
    }
    return h;
  }

  function renderImport() {
    const dlg = $('#importDlg');
    const imp = ui.imp;
    if (!imp) {
      dlg.innerHTML = `<div class="dlg dlg-wide">
        <h2>Importer un relevé</h2>
        <label class="dropzone" id="dropzone">
          <input type="file" id="importFile" accept=".csv,.txt,.tsv,text/csv" multiple hidden>
          <strong>Dépose tes fichiers CSV ici</strong>
          <span>ou <u>choisis-les sur ton ordinateur</u>. Tu peux en mettre plusieurs à la fois.</span>
        </label>
        <details class="help"><summary>Où trouver le fichier CSV de ma banque ?</summary>
          <h3>CIBC</h3>
          <p>Sur le site Services bancaires CIBC en direct (pas dans l'application mobile) : choisis le compte ou la carte, puis <b>Télécharger les transactions</b>. Choisis la période (jusqu'à 13 mois) et le format <b>CSV</b>.</p>
          <h3>Wealthsimple</h3>
          <p>Sur le site web de Wealthsimple : ouvre le compte chèques ou la carte de crédit, puis exporte son activité en CSV. Les fichiers s'appellent <code>chequing-activities-…csv</code> et <code>credit-card-activities-…csv</code>. Les relevés mensuels en CSV (dans <b>Documents</b>) sont aussi reconnus.</p>
          <p>Astuce : ajoute une note à tes virements entre comptes dans Wealthsimple (« compte urgence », « CELI », « fond de prévoyance »). L'application s'en sert pour les classer en épargne ou en investissement.</p>
          <h3>Autres banques</h3>
          <p>Cherche « Télécharger », « Exporter » ou « Historique » dans tes services en ligne et choisis CSV ou Excel CSV. Si les colonnes ne sont pas reconnues, tu pourras les choisir à la main, une seule fois : l'app retient le format.</p>
        </details>
        <div class="dlg-foot"><span class="grow"></span><button type="button" class="btn" data-action="close-dlg">Fermer</button></div>
      </div>`;
      return;
    }
    const m = imp.mapping;
    const newCount = imp.items.filter((i) => i.on).length;
    const dupCount = imp.items.filter((i) => i.dup).length;
    const nearCount = imp.items.filter((i) => i.near).length;
    const allPos = imp.items.length > 3 && imp.items.every((i) => i.amount >= 0);
    const amountMode = m.amount != null && m.amount > -1 ? 'single' : 'split';
    const progress = imp.total ? `<span class="muted small">Encore ${imp.total} fichier${imp.total > 1 ? 's' : ''} après celui-ci</span>` : '';
    dlg.innerHTML = `<div class="dlg dlg-wide">
      <div class="imp-head"><h2>${esc(imp.fileName)}</h2><span class="badge">${esc(imp.det.label)}${imp.det.remembered ? ', format mémorisé' : ''}</span>${progress}</div>
      <div class="field-row">
        <label class="field"><span>Importer dans le compte</span><select id="impAcct">${S.accounts.map((a) => `<option value="${esc(a.id)}"${a.id === imp.acct ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}<option value="__new"${imp.acct === '__new' ? ' selected' : ''}>Nouveau compte…</option></select></label>
        ${imp.acct === '__new' ? `<label class="field grow"><span>Nom du nouveau compte</span><input id="impNewName" value="${esc(imp.newName)}"></label>` : ''}
      </div>
      <label class="check"><input type="checkbox" id="impInvert"${m.invert ? ' checked' : ''}> Inverser les signes (si les achats apparaissent comme des revenus)</label>
      ${allPos && !m.invert ? '<p class="notice notice-soft">Tous les montants de ce fichier sont positifs. Si ce sont des achats par carte, coche « Inverser les signes ».</p>' : ''}
      <details class="mapping"${imp.det.generic && !imp.det.remembered ? ' open' : ''}><summary>Colonnes du fichier</summary>
        <div class="map-grid">
          <label class="check"><input type="checkbox" id="mapHeader"${m.hasHeader ? ' checked' : ''}> La première ligne contient les titres des colonnes</label>
          <label class="field"><span>Date</span><select data-map="date">${colOptions(m.date)}</select></label>
          <label class="field"><span>Format des dates</span><select id="mapOrder">
            <option value="YMD"${m.dateOrder === 'YMD' ? ' selected' : ''}>AAAA-MM-JJ</option>
            <option value="DMY"${m.dateOrder === 'DMY' ? ' selected' : ''}>JJ/MM/AAAA</option>
            <option value="MDY"${m.dateOrder === 'MDY' ? ' selected' : ''}>MM/JJ/AAAA</option></select></label>
          <label class="field"><span>Description</span><select data-map="description">${colOptions(m.description)}</select></label>
          <label class="field"><span>Montants</span><select id="mapMode">
            <option value="single"${amountMode === 'single' ? ' selected' : ''}>Une colonne (négatif = dépense)</option>
            <option value="split"${amountMode === 'split' ? ' selected' : ''}>Deux colonnes : retraits et dépôts</option></select></label>
          ${amountMode === 'single' ? `<label class="field"><span>Montant</span><select data-map="amount">${colOptions(m.amount)}</select></label>`
            : `<label class="field"><span>Retraits (dépenses)</span><select data-map="debit">${colOptions(m.debit, true)}</select></label>
               <label class="field"><span>Dépôts (revenus)</span><select data-map="credit">${colOptions(m.credit, true)}</select></label>`}
        </div>
      </details>
      <p class="result-line"><b>${newCount}</b> à importer${dupCount ? `, ${dupCount} déjà importée${dupCount > 1 ? 's' : ''}` : ''}${nearCount ? `, ${nearCount} qui ressemble${nearCount > 1 ? 'nt' : ''} à une saisie manuelle (décochée${nearCount > 1 ? 's' : ''})` : ''}${imp.skipped ? `, ${imp.skipped} ligne${imp.skipped > 1 ? 's' : ''} illisible${imp.skipped > 1 ? 's' : ''} ignorée${imp.skipped > 1 ? 's' : ''}` : ''}${imp.cancelled ? `, ${imp.cancelled} annulée${imp.cancelled > 1 ? 's' : ''} ou refusée${imp.cancelled > 1 ? 's' : ''} ignorée${imp.cancelled > 1 ? 's' : ''}` : ''}${imp.items.some((i) => i.pending) ? `, ${imp.items.filter((i) => i.pending).length} en attente (décochée${imp.items.filter((i) => i.pending).length > 1 ? 's' : ''})` : ''}.</p>
      <div class="imp-table-wrap"><table class="imp-table">
        <thead><tr><th><input type="checkbox" id="impAll" aria-label="Tout cocher"${newCount && newCount === imp.items.filter((i) => !i.dup).length ? ' checked' : ''}></th><th>Date</th><th>Description</th><th>Catégorie</th><th class="num">Montant</th></tr></thead>
        <tbody>${imp.items.map((it, i) => `<tr class="${it.dup ? 'is-dup' : ''}${it.on ? '' : ' is-off'}">
          <td><input type="checkbox" data-imp-on="${i}"${it.on ? ' checked' : ''} aria-label="Importer cette ligne"></td>
          <td class="nowrap">${shortDate(it.date)}</td>
          <td>${esc(it.description)}${it.dup ? ' <span class="tag">Déjà importée</span>' : ''}${it.pending ? ' <span class="tag">En attente</span>' : ''}${it.near ? ` <span class="tag">Saisie « ${esc(it.near.desc)} » le ${shortDate(it.near.date)}</span>` : ''}</td>
          <td><select data-imp-cat="${i}" aria-label="Catégorie">${catOptions(it.cat)}</select></td>
          <td class="num nowrap ${it.amount > 0 ? 'pos' : ''}">${signed(it.amount)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="dlg-foot">
        <button type="button" class="btn" data-action="${ui.queue.length ? 'skip-import' : 'close-dlg'}">${ui.queue.length ? 'Passer ce fichier' : 'Annuler'}</button>
        <span class="grow"></span>
        <button type="button" class="btn btn-primary" data-action="do-import"${newCount ? '' : ' disabled'}>Importer ${newCount} opération${newCount > 1 ? 's' : ''}</button>
      </div></div>`;
  }

  function doImport() {
    const imp = ui.imp;
    let acctId = imp.acct;
    if (acctId === '__new') {
      const name = (imp.newName || '').trim() || 'Nouveau compte';
      const found = S.accounts.find((a) => B.normalizeText(a.name) === B.normalizeText(name));
      if (found) acctId = found.id;
      else { acctId = B.uid(); S.accounts.push({ id: acctId, name, bank: imp.det.bank || '' }); }
    }
    const chosen = imp.items.filter((i) => i.on);
    chosen.forEach((it) => S.transactions.push(Object.assign({ id: B.uid(), date: it.date, desc: it.description, amount: it.amount, cat: it.cat || null, catSrc: it.touched ? 'user' : 'auto', acct: acctId, note: '', key: it.key, src: 'import' }, it.ruleKey ? { rk: it.ruleKey } : null, it.noRule ? { noRule: true } : null, it.hint ? { hint: it.hint } : null)));
    Object.values(imp.learn).forEach((l) => learnRule(l.desc, l.cat, true, l));
    if (imp.changed) S.profiles[imp.det.signature] = Object.assign({}, imp.mapping, { label: imp.det.label });
    S.settings.acctBySig = Object.assign(S.settings.acctBySig || {}, { [imp.det.signature + '|' + (imp.det.accountHint || '')]: acctId });
    persist();
    const acct = S.accounts.find((a) => a.id === acctId);
    toast(`${chosen.length} opération${chosen.length > 1 ? 's' : ''} importée${chosen.length > 1 ? 's' : ''} dans « ${acct.name} ».`);
    if (chosen.length && !inMonth(ui.month).length) ui.month = chosen.map((c) => c.date).sort().pop().slice(0, 7);
    render();
    nextImport();
  }

  // Données d'exemple ------------------------------------------------------------
  function loadDemo() {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const between = (a, b) => Math.round((a + rnd() * (b - a)) * 100);
    const acc = (name, bank) => {
      let a = S.accounts.find((x) => x.name === name);
      if (!a) { a = { id: B.uid(), name, bank, demo: true }; S.accounts.push(a); }
      return a.id;
    };
    const chq = acc('CIBC compte chèques', 'CIBC'), visa = acc('CIBC carte •1234', 'CIBC'), ws = acc('Wealthsimple', 'Wealthsimple');
    const out = [];
    const add = (date, desc, amount, acct) => {
      if (date > B.today()) return;
      const r = categorize(desc, amount);
      out.push({ id: B.uid(), date, desc, amount, cat: r.categoryId, catSrc: 'auto', acct, note: '', src: 'demo' });
    };
    const start = B.addMonths(B.thisMonth(), -3);
    for (let mi = 0; mi < 4; mi++) {
      const ym = B.addMonths(start, mi);
      const d = (n) => `${ym}-${String(n).padStart(2, '0')}`;
      add(d(1), 'PAYROLL DEPOSIT ACME INC', 215000, chq);
      add(d(15), 'PAYROLL DEPOSIT ACME INC', 215000, chq);
      add(d(1), 'PREAUTHORIZED DEBIT Loyer Gestion Immo', -132500, chq);
      add(d(3), 'INTERNET BILL PAY HYDRO-QUEBEC', -between(78, 132), chq);
      add(d(6), 'INTERNET BILL PAY VIDEOTRON', -8500, chq);
      add(d(10), 'PREAUTHORIZED DEBIT WEALTHSIMPLE', -25000, chq);
      add(d(2), 'Virement compte urgence', -10000, chq);
      add(d(16), 'Virement CELI placements', -40000, chq);
      add(d(10), 'Transfert de CIBC', 25000, ws);
      add(d(16), 'INTERNET BILL PAY CIBC VISA', -between(700, 1100), chq);
      add(d(16), 'PAYMENT THANK YOU/PAIEMENT MERCI', between(700, 1100), visa);
      add(d(28), 'Service Charge MONTHLY FEES', -1695, chq);
      add(d(28), 'Interest earned', between(2, 5), ws);
      add(d(5), 'NETFLIX.COM 866-579-7172 ON', -2099, visa);
      add(d(24), 'SPOTIFY P1A2B3C4D5', -1199, visa);
      add(d(9), 'STM CARTE OPUS', -9700, ws);
      for (let k = 0; k < 9; k++) add(d(1 + Math.floor(rnd() * 27)), pick(['METRO PLUS ROSEMONT MONTREAL QC', 'IGA EXTRA FAMILLE DUCHARME', 'SUPER C #0456', 'MARCHE JEAN-TALON', 'COSTCO WHOLESALE #503']), -between(25, 140), pick([visa, visa, ws]));
      for (let k = 0; k < 7; k++) add(d(1 + Math.floor(rnd() * 27)), pick(['TIM HORTONS #4521 MONTREAL QC', 'STARBUCKS 4352', 'RESTAURANT LA CHILENITA', 'UBER CANADA/UBEREATS', 'PIZZA PIZZA #77']), -between(4, 48), visa);
      for (let k = 0; k < 2; k++) add(d(2 + Math.floor(rnd() * 25)), 'SHELL C12345 LAVAL QC', -between(45, 75), visa);
      for (let k = 0; k < 2; k++) add(d(2 + Math.floor(rnd() * 25)), pick(['AMZN Mktp CA*ZX4RT5', 'DOLLARAMA #1234', 'CANADIAN TIRE #0287', 'SIMONS MONTREAL']), -between(12, 95), visa);
      add(d(2 + Math.floor(rnd() * 25)), pick(['PHARMAPRIX #0123', 'JEAN COUTU #078']), -between(9, 45), visa);
      add(d(2 + Math.floor(rnd() * 25)), pick(['CINEPLEX ENTERTAINMENT', 'SAQ SELECTION 23045', 'BIXI MONTREAL']), -between(15, 45), visa);
      add(d(12), 'E-TRANSFER Marie Tremblay', -4000, chq);
      if (mi === 2) add(d(20), 'DEPOSIT CANADA FED GST', 12975, chq);
    }
    S.transactions.push(...out);
    const demoBudgets = { logement: 135000, epicerie: 60000, restaurants: 25000, transport: 25000, factures: 25000, abonnements: 5000, magasinage: 20000, loisirs: 10000, sante: 6000 };
    if (!S.categories.some((c) => c.budget > 0)) S.categories.forEach((c) => { if (demoBudgets[c.id]) c.budget = demoBudgets[c.id]; });
    persist();
    ui.month = B.addMonths(B.thisMonth(), -1);
    toast(`${out.length} opérations d'exemple ajoutées, affichage de ${monthName(ui.month, { month: 'long' })}. Tu pourras les retirer dans Réglages.`);
    render();
  }

  // Exports -----------------------------------------------------------------------
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportCSV() {
    const cm = catMap(), am = acctMap();
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = ['date,description,montant,categorie,type,compte,note'];
    [...S.transactions].sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => {
      const c = cm[t.cat];
      lines.push([t.date, q(t.desc), (t.amount / 100).toFixed(2), q(c ? c.name : ''), c ? c.kind : '', q(am[t.acct] ? am[t.acct].name : ''), q(t.note)].join(','));
    });
    download(`budget-operations-${B.today()}.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
  }

  // Événements ----------------------------------------------------------------------
  const ROUTES = { accueil: 'dashboard', transactions: 'transactions', budgets: 'budgets', reglages: 'settings' };
  const PATHS = Object.fromEntries(Object.entries(ROUTES).map(([k, v]) => [v, k]));
  function route() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    ui.view = ROUTES[h] || 'dashboard';
    ui.limit = 200;
    render();
  }
  function go(view) { location.hash = '#/' + PATHS[view]; }

  document.addEventListener('click', (e) => {
    const qt = e.target.closest('[data-qtype]');
    if (qt) {
      ui.quick.type = qt.dataset.qtype;
      $$('[data-qtype]').forEach((b) => b.setAttribute('aria-pressed', String(b === qt)));
      const c = catOf(ui.quick.cat);
      if (ui.quick.catTouched && c && !fitsType(c, ui.quick.type)) ui.quick.catTouched = false;
      updateQuickPreview();
      $('#quickInput').focus();
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'SELECT') return;
    const a = el.dataset.action;
    const txId = el.closest('[data-id]') && el.closest('[data-id]').dataset.id;
    switch (a) {
      case 'prev-month': ui.month = B.addMonths(ui.month, -1); render(); break;
      case 'next-month': ui.month = B.addMonths(ui.month, 1); render(); break;
      case 'open-import': startImport(); break;
      case 'close-dlg': { const d = el.closest('dialog'); if (d) d.close(); if (d && d.id === 'importDlg') { ui.imp = null; ui.queue = []; } break; }
      case 'skip-import': nextImport(); break;
      case 'do-import': doImport(); break;
      case 'go': go(el.dataset.to); break;
      case 'show-uncat': ui.filters = { q: '', cat: '__none', acct: '', type: '', scope: 'month' }; go('transactions'); break;
      case 'clear-filters': ui.filters = Object.assign(ui.filters, { q: '', cat: '', acct: '', type: '' }); render(); break;
      case 'more': ui.limit += 200; render(); break;
      case 'edit-tx': openEdit(txId); break;
      case 'pick-icon': openIconPicker(el.dataset.target); break;
      case 'choose-icon': chooseIcon(el.dataset.icon); break;
      case 'delete-tx': {
        const id = el.dataset.id;
        const t = S.transactions.find((x) => x.id === id);
        S.transactions = S.transactions.filter((x) => x.id !== id);
        persist(); $('#editDlg').close(); render();
        toast('Opération supprimée.', { label: 'Annuler', run: () => { S.transactions.push(t); persist(); render(); } });
        break;
      }
      case 'suggest-budgets': {
        let n = 0;
        S.categories.filter((c) => c.kind === 'expense').forEach((c) => {
          const avg = avgSpent(c.id, 3);
          if (avg > 0) { c.budget = Math.ceil(avg / 1000) * 1000; n++; }
        });
        persist(); render();
        toast(n ? `${n} budgets proposés d'après tes 3 derniers mois, arrondis à la dizaine. Ajuste-les au besoin.` : 'Pas assez d\'historique : importe d\'abord quelques mois de relevés.');
        break;
      }
      case 'del-acct': {
        const id = el.dataset.id;
        const n = S.transactions.filter((t) => t.acct === id).length;
        const acc = S.accounts.find((x) => x.id === id);
        if (n && !confirm(`Supprimer « ${acc.name} » et ses ${n} opérations ?`)) break;
        S.transactions = S.transactions.filter((t) => t.acct !== id);
        S.accounts = S.accounts.filter((x) => x.id !== id);
        persist(); render(); toast(`Compte « ${acc.name} » supprimé.`);
        break;
      }
      case 'del-cat': {
        const id = el.dataset.id;
        const c = catOf(id);
        const n = S.transactions.filter((t) => t.cat === id).length;
        if (n && !confirm(`Supprimer « ${c.name} » ? Ses ${n} opérations deviendront « à catégoriser ».`)) break;
        S.transactions.forEach((t) => { if (t.cat === id) { t.cat = null; t.catSrc = 'auto'; } });
        S.rules = S.rules.filter((r) => r.categoryId !== id);
        S.categories = S.categories.filter((x) => x.id !== id);
        persist(); render();
        break;
      }
      case 'del-rule': S.rules = S.rules.filter((r) => r.id !== el.dataset.id); persist(); render(); break;
      case 'reapply-rules': {
        let n = 0;
        S.transactions.forEach((t) => {
          if (t.catSrc === 'user') return;
          const r = categorize(t.desc, t.amount, t.hint);
          if (r.categoryId && r.categoryId !== t.cat) { t.cat = r.categoryId; n++; }
        });
        persist(); render();
        toast(n ? `${n} opération${n > 1 ? 's' : ''} reclassée${n > 1 ? 's' : ''}. Tes choix manuels n'ont pas été touchés.` : 'Tout est déjà classé selon les règles.');
        break;
      }
      case 'export-json': download(`budget-sauvegarde-${B.today()}.json`, JSON.stringify(S, (k, v) => (k.startsWith('_') ? undefined : v), 1), 'application/json'); break;
      case 'export-csv': exportCSV(); break;
      case 'load-demo': loadDemo(); break;
      case 'remove-demo': {
        S.transactions = S.transactions.filter((t) => t.src !== 'demo');
        const used = new Set(S.transactions.map((t) => t.acct));
        S.accounts = S.accounts.filter((x) => !x.demo || used.has(x.id));
        persist(); render(); toast('Données d\'exemple retirées.');
        break;
      }
      case 'wipe':
        if (confirm('Effacer toutes les opérations, catégories, budgets et règles de ce navigateur ? Exporte une sauvegarde avant si tu veux les garder.')) {
          B.clear(); S = B.defaultState(); persist(); render(); toast('Toutes les données ont été effacées.');
        }
        break;
      default: break;
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'quickInput') { ui.quick.text = t.value; updateQuickPreview(); return; }
    if (t.id === 'fQ') {
      ui.filters.q = t.value;
      clearTimeout(t._deb);
      t._deb = setTimeout(() => { render(); const i = $('#fQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200);
      return;
    }
    if (t.id === 'impNewName') { ui.imp.newName = t.value; }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    const d = t.dataset;
    if (t.id === 'quickCat') {
      ui.quick.cat = t.value; ui.quick.catTouched = true;
      const c = catOf(t.value);
      if (c && c.kind !== 'transfer') { ui.quick.type = c.kind === 'income' ? 'income' : 'expense'; $$('[data-qtype]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.qtype === ui.quick.type))); updateQuickPreview(); }
      return;
    }
    if (t.id === 'quickDate') { ui.quick.date = t.value || B.today(); return; }
    if (t.id === 'quickAcct') { ui.quick.acct = t.value; return; }
    if (d.action === 'set-cat') {
      const tx = S.transactions.find((x) => x.id === t.closest('[data-id]').dataset.id);
      tx.cat = t.value || null; tx.catSrc = 'user';
      persist();
      const row = t.closest('.tx');
      row.classList.toggle('is-uncat', !tx.cat);
      row.querySelector('.cat-ico').outerHTML = catIcon(catOf(tx.cat));
      afterCategoryChange(tx);
      if (ui.filters.cat === '__none' || ui.view === 'dashboard') render();
      return;
    }
    const filterIds = { fCat: 'cat', fAcct: 'acct', fType: 'type', fScope: 'scope' };
    if (filterIds[t.id]) { ui.filters[filterIds[t.id]] = t.value; ui.limit = 200; render(); return; }
    if (d.budget) {
      const v = B.parseAmount(t.value);
      catOf(d.budget).budget = v ? Math.abs(v) : 0;
      persist(); render(); return;
    }
    if (d.acctName) { const a = S.accounts.find((x) => x.id === d.acctName); a.name = t.value.trim() || a.name; persist(); return; }
    if (d.catName) { catOf(d.catName).name = t.value.trim() || catOf(d.catName).name; persist(); return; }
    if (d.catKind) { catOf(d.catKind).kind = t.value; persist(); return; }
    if (d.rulePattern) { S.rules.find((r) => r.id === d.rulePattern).pattern = t.value.trim(); persist(); return; }
    if (d.ruleCat) { S.rules.find((r) => r.id === d.ruleCat).categoryId = t.value; persist(); return; }
    if (t.id === 'restoreFile' && t.files[0]) {
      t.files[0].text().then((txt) => {
        try {
          const data = JSON.parse(txt);
          if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) throw new Error('format');
          if (!confirm(`Remplacer les données actuelles par cette sauvegarde (${data.transactions.length} opérations) ?`)) return;
          S = B.migrate(data); persist(); render(); toast('Sauvegarde restaurée.');
        } catch (err) { toast("Ce fichier n'est pas une sauvegarde de cette application."); }
      });
      return;
    }
    // Import
    if (t.id === 'importFile') { startImport(t.files); return; }
    const imp = ui.imp;
    if (!imp) return;
    if (t.id === 'impAcct') { imp.acct = t.value; renderImport(); return; }
    if (t.id === 'impInvert') { imp.mapping.invert = t.checked; imp.changed = true; buildPreview(); renderImport(); return; }
    if (t.id === 'mapHeader') { imp.mapping.hasHeader = t.checked; imp.changed = true; buildPreview(); renderImport(); return; }
    if (t.id === 'mapOrder') { imp.mapping.dateOrder = t.value; imp.changed = true; buildPreview(); renderImport(); return; }
    if (t.id === 'mapMode') {
      if (t.value === 'single') { imp.mapping.amount = imp.mapping.debit != null && imp.mapping.debit > -1 ? imp.mapping.debit : 2; imp.mapping.debit = null; imp.mapping.credit = null; }
      else { imp.mapping.debit = imp.mapping.amount; imp.mapping.credit = -1; imp.mapping.amount = null; }
      imp.changed = true; buildPreview(); renderImport(); return;
    }
    if (d.map) { imp.mapping[d.map] = +t.value; imp.changed = true; buildPreview(); renderImport(); return; }
    if (t.id === 'impAll') { imp.items.forEach((i) => { if (!i.dup) i.on = t.checked; }); renderImport(); return; }
    if (d.impOn != null) { imp.items[+d.impOn].on = t.checked; renderImport(); return; }
    if (d.impCat != null) {
      const it = imp.items[+d.impCat];
      it.cat = t.value; it.touched = true;
      if (t.value && !it.noRule) {
        // Même commerce, même bénéficiaire ou même note ailleurs dans le fichier : même catégorie
        const pattern = it.ruleKey ? it.ruleKey + ' ' : B.merchantKey(it.description);
        if (B.normalizeText(pattern).length >= 3) {
          imp.items.forEach((o) => { if (!o.touched && !o.noRule && B.matchesKey(o.description, pattern)) o.cat = t.value; });
          imp.learn[pattern] = { desc: it.description, cat: t.value, rk: it.ruleKey, hint: it.hint, amount: it.amount };
        }
      }
      renderImport();
    }
  });

  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.id === 'quickForm') { e.preventDefault(); submitQuick(); return; }
    if (f.id === 'editForm') { e.preventDefault(); if (saveEdit(f) !== false) $('#editDlg').close(); return; }
    const kind = f.dataset.form;
    if (!kind) return;
    e.preventDefault();
    const fd = new FormData(f);
    if (kind === 'add-acct') S.accounts.push({ id: B.uid(), name: String(fd.get('name')).trim(), bank: '' });
    if (kind === 'add-cat') {
      const name = String(fd.get('name')).trim();
      let id = B.normalizeText(name).replace(/ /g, '-') || B.uid();
      if (catOf(id)) id += '-' + B.uid().slice(-4);
      S.categories.push({ id, name, icon: ui.newCatIcon, kind: fd.get('kind'), budget: 0 });
      ui.newCatIcon = 'tag';
    }
    if (kind === 'add-rule') {
      if (!fd.get('cat')) { toast('Choisis une catégorie pour cette règle.'); return; }
      S.rules.push({ id: B.uid(), pattern: String(fd.get('pattern')).trim(), categoryId: fd.get('cat') });
    }
    persist(); render();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) {
      const i = $('#quickInput'); if (i) { e.preventDefault(); i.focus(); }
    }
  });

  // Glisser-déposer un CSV n'importe où
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; dragDepth++; $('#dropOverlay').classList.add('is-on'); });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropOverlay').classList.remove('is-on'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $('#dropOverlay').classList.remove('is-on');
    startImport(e.dataTransfer.files);
  });

  $('#importDlg').addEventListener('close', () => { ui.imp = null; ui.queue = []; });
  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(drawChart, 150); });
  $$('[data-ico]').forEach((el) => el.insertAdjacentHTML('afterbegin', B.icon(el.dataset.ico)));
  window.addEventListener('hashchange', route);
  window.addEventListener('storage', (e) => { if (e.key === B.KEY) { S = B.load(); render(); } });
  route();
})();
