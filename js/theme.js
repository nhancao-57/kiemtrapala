/* Apply the main site's preference before the page is painted. */
(() => {
  const system = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function apply() {
    let saved;
    try { saved = localStorage.getItem('theme'); } catch (_) { /* Storage may be unavailable. */ }
    const dark = saved === 'dark' || (saved !== 'light' && !!system?.matches);
    document.documentElement.classList.toggle('dark', dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1E293B' : '#FFFFFF');
  }
  apply();
  system?.addEventListener('change', apply);
  window.addEventListener('storage', apply);
})();
