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
