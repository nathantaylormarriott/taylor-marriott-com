/** Injected into proxied client preview pages inside checkout device iframes. */
export const CHECKOUT_PREVIEW_SCROLL_SCRIPT = `<script>(function(){
  if (window.__tmPreviewScroll) return;
  window.__tmPreviewScroll = true;
  var root = document.documentElement;
  root.style.scrollBehavior = 'auto';
  var block = function(e){ e.preventDefault(); };
  window.addEventListener('wheel', block, {passive:false});
  window.addEventListener('touchmove', block, {passive:false});
  window.addEventListener('keydown', function(e){
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'Home' || e.key === 'End' || e.key === ' ') e.preventDefault();
  });
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  var phase = 'wait';
  var hold = 0.8;
  var last = 0;
  var fadeStart = 0;
  function tick(now) {
    if (!document.body) { requestAnimationFrame(tick); return; }
    if (!last) last = now;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    var max = Math.max(0, root.scrollHeight - window.innerHeight);
    var body = document.body;
    if (phase === 'wait') {
      hold -= dt;
      if (hold <= 0 && max > 24) phase = 'scroll';
    } else if (phase === 'scroll') {
      var y = window.scrollY + 32 * dt;
      if (y >= max) {
        window.scrollTo(0, max);
        phase = 'out';
        fadeStart = now;
      } else {
        window.scrollTo(0, y);
      }
    } else if (phase === 'out') {
      var p = Math.min(1, (now - fadeStart) / 700);
      var e = p * p;
      body.style.filter = 'blur(' + (22 * e).toFixed(2) + 'px)';
      body.style.opacity = String(1 - e);
      if (p >= 1) {
        window.scrollTo(0, 0);
        phase = 'in';
        fadeStart = now;
      }
    } else if (phase === 'in') {
      var q = Math.min(1, (now - fadeStart) / 800);
      var f = 1 - Math.pow(1 - q, 2);
      body.style.filter = 'blur(' + (22 * (1 - f)).toFixed(2) + 'px)';
      body.style.opacity = String(f);
      if (q >= 1) {
        body.style.filter = '';
        body.style.opacity = '';
        phase = 'wait';
        hold = 0.6;
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();</script>`;
