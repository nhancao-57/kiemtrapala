/* Apply the main site's preference before the page is painted. */
(() => {
  const system = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let saved;
  function readPreference() {
    try { saved = localStorage.getItem('theme'); } catch (_) { /* Keep the in-memory preference if storage is unavailable. */ }
  }
  function apply() {
    const dark = saved === 'dark' || (saved !== 'light' && !!system?.matches);
    document.documentElement.classList.toggle('dark', dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1E293B' : '#FFFFFF');
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-pressed', String(dark));
    });
  }
  readPreference();
  apply();
  document.addEventListener('site-header-ready', apply);
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    saved = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    try { localStorage.setItem('theme', saved); } catch (_) { /* Switching still works for this page. */ }
    apply();
  });
  system?.addEventListener('change', apply);
  window.addEventListener('storage', () => { readPreference(); apply(); });
})();
