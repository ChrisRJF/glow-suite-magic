(function () {
  if (window.__glowsuiteShopWidgetLoaded) return;
  window.__glowsuiteShopWidgetLoaded = true;
  var script = document.currentScript || document.querySelector('script[data-glowsuite-shop]');
  var origin = new URL(script && script.src ? script.src : window.location.href).origin;
  var salon = (script && (script.getAttribute('data-salon') || script.getAttribute('data-shop'))) || '';
  var height = (script && script.getAttribute('data-height')) || '720';
  var selector = (script && script.getAttribute('data-target')) || '[data-glowsuite-shop]';
  function url() { return origin + '/shop/' + encodeURIComponent(salon) + '?embed=1'; }
  function injectStyles() {
    if (document.getElementById('gs-shop-widget-styles')) return;
    var style = document.createElement('style');
    style.id = 'gs-shop-widget-styles';
    style.textContent = '.gs-shop-inline{width:100%;border:0;border-radius:16px;box-shadow:0 16px 40px rgba(15,23,42,.12);background:#fff;overflow:hidden}.gs-shop-fab{position:fixed;right:20px;bottom:20px;z-index:2147483000;border:0;border-radius:999px;background:#7B61FF;color:#fff;padding:14px 18px;font:600 14px system-ui,-apple-system,sans-serif;box-shadow:0 12px 30px rgba(123,97,255,.3);cursor:pointer}.gs-shop-overlay{position:fixed;inset:0;z-index:2147483001;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px}.gs-shop-modal{width:min(1040px,100%);height:min(760px,92vh);border:0;border-radius:18px;background:#fff;box-shadow:0 24px 80px rgba(15,23,42,.25)}@media(max-width:640px){.gs-shop-overlay{padding:0}.gs-shop-modal{width:100%;height:100%;border-radius:0}.gs-shop-fab{right:14px;bottom:14px}}';
    document.head.appendChild(style);
  }
  function openModal() {
    closeModal();
    var overlay = document.createElement('div');
    overlay.className = 'gs-shop-overlay';
    overlay.setAttribute('data-gs-shop-overlay', '');
    overlay.innerHTML = '<iframe class="gs-shop-modal" src="' + url() + '" allow="payment *"></iframe>';
    overlay.addEventListener('click', function (event) { if (event.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
  }
  function closeModal() {
    var overlay = document.querySelector('[data-gs-shop-overlay]');
    if (overlay) overlay.remove();
  }
  function renderInline() {
    var nodes = document.querySelectorAll(selector);
    nodes.forEach(function (node) {
      if (node.getAttribute('data-gs-shop-rendered')) return;
      node.setAttribute('data-gs-shop-rendered', '1');
      var iframe = document.createElement('iframe');
      iframe.className = 'gs-shop-inline';
      iframe.src = url();
      iframe.height = node.getAttribute('data-height') || height;
      iframe.setAttribute('allow', 'payment *');
      node.innerHTML = '';
      node.appendChild(iframe);
    });
    return nodes.length > 0;
  }
  function boot() {
    injectStyles();
    if (!renderInline()) {
      var button = document.createElement('button');
      button.className = 'gs-shop-fab';
      button.type = 'button';
      button.textContent = 'Shop producten';
      button.addEventListener('click', openModal);
      document.body.appendChild(button);
    }
    window.GlowSuiteShop = { open: openModal, close: closeModal, refresh: renderInline };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
