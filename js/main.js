/* Shared layout: serve the site over HTTP so HTML fragments can be fetched. */
(() => {
  async function fragment(path, selector) {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok || response.redirected) {
      throw new Error(`Unable to load ${path}: ${response.status}`);
    }
    const template = document.createElement('template');
    template.innerHTML = await response.text();
    const element = template.content.querySelector(selector);
    if (!element) throw new Error(`Missing ${selector} in ${path}`);
    return element;
  }

  async function loadHeader() {
    const placeholder = document.querySelector('[data-site-header]');
    if (!placeholder) return;
    const header = await fragment('/header.html', 'header');
    const inner = header.firstElementChild;
    const controls = placeholder.firstElementChild;
    // Move the original controls, preserving listeners and references held by exams.
    if (controls.querySelector('#btn-return')) {
      inner.className = controls.className;
      const logo = inner.querySelector('img');
      const returnLink = controls.querySelector('#btn-return');
      inner.insertBefore(returnLink, logo);
      logo.after(...controls.childNodes);
    }
    if (placeholder.hasAttribute('data-hide-logout')) {
      header.querySelector('.site-logout')?.remove();
    }
    header.dataset.siteHeader = '';
    placeholder.replaceWith(header);
    document.dispatchEvent(new Event('site-header-ready'));
  }

  async function loadFooter() {
    const placeholder = document.querySelector('[data-site-footer]');
    if (placeholder) placeholder.replaceWith(await fragment('/footer.html', 'footer'));
  }

  // A failed fragment does not prevent the other fragment or page scripts loading.
  window.siteLayoutReady = Promise.allSettled([loadHeader(), loadFooter()]).then(results => {
    results.forEach(result => {
      if (result.status === 'rejected') console.error('Shared layout:', result.reason);
    });
  });
})();
