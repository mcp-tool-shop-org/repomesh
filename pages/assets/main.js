// Copy-to-clipboard for code blocks
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('copy-btn')) {
    const pre = e.target.closest('.copy-wrap')?.querySelector('pre');
    if (!pre) return;
    navigator.clipboard.writeText(pre.textContent.trim()).then(() => {
      const orig = e.target.textContent;
      e.target.textContent = 'Copied!';
      setTimeout(() => { e.target.textContent = orig; }, 1500);
    });
  }

  // Timeline pill → detail drawer
  const pill = e.target.closest('.timeline-pill');
  if (pill) {
    const detail = document.getElementById('timeline-detail');
    if (!detail) return;
    const data = pill.getAttribute('data-detail');
    if (detail.hidden || detail.dataset.active !== pill.textContent.trim()) {
      detail.textContent = data;
      detail.hidden = false;
      detail.dataset.active = pill.textContent.trim();
      document.querySelectorAll('.timeline-pill').forEach(p => p.classList.remove('pill-active'));
      pill.classList.add('pill-active');
    } else {
      detail.hidden = true;
      detail.dataset.active = '';
      pill.classList.remove('pill-active');
    }
  }
});

// ---------------------------------------------------------------------------
// FC9 — /repos browse: client-side search / filter / sort (vanilla JS, no deps).
// Operates on the server-rendered <tr class="repo-row"> rows via their data-*
// attributes. The page works fully with JS disabled; this only enhances it.
// ---------------------------------------------------------------------------
(function () {
  const table = document.getElementById('repos-table');
  if (!table) return; // only on /repos
  const tbody = document.getElementById('repos-tbody');
  const search = document.getElementById('repo-search');
  const emptyMsg = document.getElementById('repos-empty');
  const filters = Array.from(document.querySelectorAll('[data-filter]'));
  const allRows = Array.from(tbody.querySelectorAll('tr.repo-row'));

  let sortKey = null;
  let sortDir = 1; // 1 asc, -1 desc

  function rowVal(tr, key) {
    return tr.getAttribute('data-' + key) || '';
  }

  function applyFilters() {
    const q = (search && search.value || '').trim().toLowerCase();
    let visible = 0;
    for (const tr of allRows) {
      let show = true;
      // text search across repo + version
      if (q) {
        const hay = (rowVal(tr, 'repo') + ' ' + rowVal(tr, 'version')).toLowerCase();
        if (!hay.includes(q)) show = false;
      }
      // dropdown filters (exact match on the data-* attr)
      if (show) {
        for (const f of filters) {
          const key = f.getAttribute('data-filter');
          const want = f.value;
          if (want !== '' && rowVal(tr, key) !== want) { show = false; break; }
        }
      }
      tr.hidden = !show;
      if (show) visible++;
    }
    if (emptyMsg) emptyMsg.hidden = visible !== 0;
  }

  function applySort() {
    if (!sortKey) return;
    const type = (table.querySelector('th[data-sort="' + sortKey + '"]') || {}).dataset
      ? table.querySelector('th[data-sort="' + sortKey + '"]').getAttribute('data-type')
      : 'text';
    const sorted = allRows.slice().sort((a, b) => {
      let va = rowVal(a, sortKey), vb = rowVal(b, sortKey);
      if (type === 'num') { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; return (va - vb) * sortDir; }
      return va.localeCompare(vb) * sortDir;
    });
    for (const tr of sorted) tbody.appendChild(tr);
  }

  if (search) search.addEventListener('input', applyFilters);
  for (const f of filters) f.addEventListener('change', applyFilters);

  function sortHandler(th) {
    const key = th.getAttribute('data-sort');
    if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = 1; }
    table.querySelectorAll('th[data-sort]').forEach(h => h.removeAttribute('aria-sort'));
    th.setAttribute('aria-sort', sortDir === 1 ? 'ascending' : 'descending');
    applySort();
  }
  table.querySelectorAll('th[data-sort]').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => sortHandler(th));
    th.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); sortHandler(th); }
    });
  });
})();
