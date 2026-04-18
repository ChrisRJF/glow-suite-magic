/* GlowSuite Booking Widget
 * Loads a salon's booking flow as a floating button + popup, or inline.
 *
 * Usage (auto floating button):
 *   <script src="https://book.glowsuite.nl/widget.js" data-salon="salon-slug" async></script>
 *
 * Inline embed:
 *   <div data-glowsuite-booking></div>
 *   <script src="https://book.glowsuite.nl/widget.js" data-salon="salon-slug" async></script>
 *
 * Custom trigger:
 *   <button data-glowsuite-trigger>Boek nu</button>
 */
(function () {
  if (window.__glowsuiteWidgetLoaded) return;
  window.__glowsuiteWidgetLoaded = true;

  var script = document.currentScript ||
    (function () {
      var s = document.getElementsByTagName('script');
      return s[s.length - 1];
    })();

  var SCRIPT_ORIGIN = (function () {
    try { return new URL(script.src).origin; } catch (e) { return 'https://book.glowsuite.nl'; }
  })();

  var SALON = (script && script.getAttribute('data-salon')) || '';
  var PRIMARY = (script && script.getAttribute('data-color')) || '#7B61FF';
  var LABEL = (script && script.getAttribute('data-label')) || 'Boek nu';
  var POSITION = (script && script.getAttribute('data-position')) || 'bottom-right';
  var INLINE_SELECTOR = '[data-glowsuite-booking]';
  var TRIGGER_SELECTOR = '[data-glowsuite-trigger]';

  function bookingUrl(extra) {
    var url = SCRIPT_ORIGIN + '/boeken?embed=1';
    if (SALON) url += '&salon=' + encodeURIComponent(SALON);
    if (extra) url += extra;
    return url;
  }

  // ---------- Styles ----------
  var css = ''
    + '.gs-fab{position:fixed;z-index:2147483000;bottom:20px;right:20px;'
    + 'background:' + PRIMARY + ';color:#fff;border:0;border-radius:9999px;'
    + 'padding:14px 22px;font:600 14px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;'
    + 'box-shadow:0 10px 30px rgba(0,0,0,.18);cursor:pointer;display:inline-flex;align-items:center;gap:8px;'
    + 'transition:transform .15s ease, box-shadow .15s ease}'
    + '.gs-fab:hover{transform:translateY(-1px);box-shadow:0 14px 36px rgba(0,0,0,.22)}'
    + '.gs-fab.bottom-left{right:auto;left:20px}'
    + '.gs-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483001;'
    + 'display:flex;align-items:center;justify-content:center;padding:24px;'
    + 'opacity:0;transition:opacity .2s ease}'
    + '.gs-overlay.open{opacity:1}'
    + '.gs-modal{position:relative;background:#fff;border-radius:16px;width:100%;max-width:520px;'
    + 'height:min(820px,90vh);box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:hidden;'
    + 'transform:translateY(8px);transition:transform .2s ease}'
    + '.gs-overlay.open .gs-modal{transform:translateY(0)}'
    + '.gs-close{position:absolute;top:10px;right:10px;z-index:2;width:34px;height:34px;border-radius:9999px;'
    + 'border:0;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;font:600 18px/1 sans-serif;'
    + 'display:flex;align-items:center;justify-content:center}'
    + '.gs-close:hover{background:rgba(0,0,0,.75)}'
    + '.gs-iframe{width:100%;height:100%;border:0;display:block;background:#fff}'
    + '.gs-inline{width:100%;min-height:720px;border:0;border-radius:12px;overflow:hidden;display:block}'
    + '@media (max-width:640px){.gs-overlay{padding:0}.gs-modal{max-width:100%;height:100vh;border-radius:0}.gs-close{top:8px;right:8px}}';

  function injectStyles() {
    if (document.getElementById('gs-widget-styles')) return;
    var style = document.createElement('style');
    style.id = 'gs-widget-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------- Modal ----------
  var overlayEl = null;
  function openModal() {
    if (overlayEl) { overlayEl.classList.add('open'); return; }
    overlayEl = document.createElement('div');
    overlayEl.className = 'gs-overlay';
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.innerHTML =
      '<div class="gs-modal">'
      + '<button class="gs-close" aria-label="Sluiten">×</button>'
      + '<iframe class="gs-iframe" src="' + bookingUrl() + '" title="Online boeken" allow="payment *"></iframe>'
      + '</div>';
    document.body.appendChild(overlayEl);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { overlayEl.classList.add('open'); });
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) closeModal();
    });
    overlayEl.querySelector('.gs-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', escClose);
  }
  function closeModal() {
    if (!overlayEl) return;
    overlayEl.classList.remove('open');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', escClose);
    setTimeout(function () {
      if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
      overlayEl = null;
    }, 200);
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }

  // ---------- Inline ----------
  function renderInline() {
    var nodes = document.querySelectorAll(INLINE_SELECTOR);
    nodes.forEach(function (node) {
      if (node.__gsRendered) return;
      node.__gsRendered = true;
      var iframe = document.createElement('iframe');
      iframe.className = 'gs-inline';
      iframe.src = bookingUrl();
      iframe.title = 'Online boeken';
      iframe.setAttribute('allow', 'payment *');
      var height = node.getAttribute('data-height');
      if (height) iframe.style.minHeight = height + (/\d$/.test(height) ? 'px' : '');
      node.appendChild(iframe);
    });
  }

  // ---------- Triggers ----------
  function bindTriggers() {
    document.querySelectorAll(TRIGGER_SELECTOR).forEach(function (btn) {
      if (btn.__gsBound) return;
      btn.__gsBound = true;
      btn.addEventListener('click', function (e) { e.preventDefault(); openModal(); });
    });
  }

  // ---------- Floating button ----------
  function injectFab() {
    if (document.querySelector('.gs-fab')) return;
    if (document.querySelector(INLINE_SELECTOR)) return; // inline mode → no FAB
    if (document.querySelector(TRIGGER_SELECTOR)) return; // custom trigger → no FAB
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gs-fab' + (POSITION === 'bottom-left' ? ' bottom-left' : '');
    btn.innerHTML = '<span style="font-size:16px">📅</span><span>' + LABEL + '</span>';
    btn.addEventListener('click', openModal);
    document.body.appendChild(btn);
  }

  // ---------- Public API ----------
  window.GlowSuite = window.GlowSuite || {};
  window.GlowSuite.open = openModal;
  window.GlowSuite.close = closeModal;
  window.GlowSuite.refresh = function () { bindTriggers(); renderInline(); };

  // ---------- Boot ----------
  function boot() {
    injectStyles();
    renderInline();
    bindTriggers();
    injectFab();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
