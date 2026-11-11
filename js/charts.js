/* Graphique en colonnes « revenus et dépenses par mois », en SVG, sans bibliothèque. */
(function (root) {
  'use strict';
  const B = (root.Budget = root.Budget || {});
  const NS = 'http://www.w3.org/2000/svg';

  function niceStep(max, ticks) {
    const raw = max / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag;
    return 10 * mag;
  }

  function tickLabel(v, compact) {
    if (compact && v >= 1000) return (v / 1000).toLocaleString('fr-CA', { maximumFractionDigits: 1 }) + ' k';
    return v.toLocaleString('fr-CA');
  }

  // Colonne arrondie (4 px) en haut, carrée à la base
  function colPath(x, y, w, h) {
    if (h <= 0) return '';
    const r = Math.min(4, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  /**
   * data : [{ label, longLabel, income, expense }] en cents.
   * money : fonction de formatage des montants.
   */
  function monthlyChart(el, data, money) {
    const width = Math.max(280, el.clientWidth || 560);
    const height = 220;
    const m = { top: 10, right: 8, bottom: 26, left: 46 };
    const pw = width - m.left - m.right, ph = height - m.top - m.bottom;
    const maxCents = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
    const maxD = maxCents / 100;
    const step = niceStep(maxD, 4);
    const top = Math.ceil(maxD / step) * step || step;
    const compact = top >= 10000;
    const y = (v) => m.top + ph - (v / top) * ph;
    const band = pw / data.length;
    const bw = Math.min(24, Math.max(6, band * 0.28));

    let svg = `<svg xmlns="${NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Revenus et dépenses des ${data.length} derniers mois">`;
    for (let v = 0; v <= top + 1e-9; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      svg += `<line class="ch-grid${v === 0 ? ' ch-base' : ''}" x1="${m.left}" x2="${width - m.right}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="ch-tick" x="${m.left - 8}" y="${yy + 4}" text-anchor="end">${tickLabel(v, compact)}</text>`;
    }
    data.forEach((d, i) => {
      const cx = m.left + band * i + band / 2;
      const inc = d.income / 100, exp = d.expense / 100;
      const hi = (inc / top) * ph, he = (exp / top) * ph;
      svg += `<path class="ch-inc" d="${colPath(cx - bw - 1, y(inc), bw, hi)}"/>`;
      svg += `<path class="ch-exp" d="${colPath(cx + 1, y(exp), bw, he)}"/>`;
      svg += `<text class="ch-tick" x="${cx}" y="${height - 8}" text-anchor="middle">${d.label}</text>`;
      svg += `<rect class="ch-hit" data-i="${i}" x="${m.left + band * i}" y="${m.top}" width="${band}" height="${ph}" tabindex="0" aria-label="${d.longLabel} : revenus ${money(d.income)}, dépenses ${money(d.expense)}"/>`;
    });
    svg += '</svg>';
    el.innerHTML = svg + '<div class="ch-tip" hidden></div>';
    el.style.position = 'relative';

    const tip = el.querySelector('.ch-tip');
    const show = (rect) => {
      const d = data[+rect.dataset.i];
      el.querySelectorAll('.ch-hit').forEach((r) => r.classList.toggle('is-hover', r === rect));
      const net = d.income - d.expense;
      tip.innerHTML = `<strong>${d.longLabel}</strong>
        <span><i class="sw sw-inc"></i>Revenus <b>${money(d.income)}</b></span>
        <span><i class="sw sw-exp"></i>Dépenses <b>${money(d.expense)}</b></span>
        <span class="tip-net">Solde <b>${(net >= 0 ? '+' : '−') + money(Math.abs(net))}</b></span>`;
      tip.hidden = false;
      const x = +rect.getAttribute('x') + band / 2;
      const tw = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(0, x - tw / 2), width - tw) + 'px';
      tip.style.top = '0px';
    };
    const hide = () => { tip.hidden = true; el.querySelectorAll('.ch-hit').forEach((r) => r.classList.remove('is-hover')); };
    el.querySelectorAll('.ch-hit').forEach((r) => {
      r.addEventListener('mouseenter', () => show(r));
      r.addEventListener('focus', () => show(r));
      r.addEventListener('mouseleave', hide);
      r.addEventListener('blur', hide);
    });
  }

  B.monthlyChart = monthlyChart;
})(typeof window !== 'undefined' ? window : globalThis);
