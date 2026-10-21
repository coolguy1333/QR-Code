document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  const label = b.textContent;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied ✓'; } catch { b.textContent = 'Press and hold to copy'; }
  setTimeout(() => { b.textContent = label; }, 1600);
});
