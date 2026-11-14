/* Progressive motion: the whole game remains visible if this script is absent. */
(() => {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const selector = '.book-cover-container, .chambers-hero, .chamber-card, .parchment-window, .tea-menu-parchment, .hint-card, .flag-submit-card';
  let observer;
  let mutations;
  let puzzleAnimations = [];

  document.addEventListener('wonderhack:puzzle-loaded', event => {
    puzzleAnimations.forEach(animation => animation.cancel());
    puzzleAnimations = [];
    if (preference.matches || event.detail.puzzle.queenCorrupted) return;
    ['.parchment-header', '#puzzle-question-text', '#puzzle-solution-form'].forEach((selector, index) => {
      const node = document.querySelector(selector);
      if (!node?.animate) return;
      puzzleAnimations.push(node.animate([
        { opacity: 0, transform: 'translateY(16px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 450, delay: index * 75, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }));
    });
  });

  document.addEventListener('wonderhack:puzzle-solved', () => {
    if (preference.matches) return;
    const question = document.getElementById('puzzle-question-text');
    question?.animate?.([
      { boxShadow: '0 0 0 0 #d6ac5660' },
      { boxShadow: '0 0 0 16px #d6ac5600', offset: .75 },
      { boxShadow: '0 0 0 0 #d6ac5600' },
    ], { duration: 750, easing: 'ease-out' });
    document.getElementById('next-puzzle-btn')?.animate?.([
      { transform: 'translateY(5px)', opacity: 0 },
      { transform: 'translateY(-3px)', opacity: 1 },
      { transform: 'translateY(0)', opacity: 1 },
    ], { duration: 500, easing: 'ease-out' });
  });

  function reveal(root) {
    const nodes = [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
    nodes.forEach((node, index) => {
      if (node.classList.contains('wh-reveal')) return;
      node.classList.add('wh-reveal');
      node.style.setProperty('--reveal-delay', `${Math.min(index % 3, 2) * 65}ms`);
      observer.observe(node);
    });
  }

  function start() {
    if (preference.matches || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in-view');
        observer.unobserve(entry.target);
      });
    }, { threshold: .08 });
    reveal(document);
    mutations = new MutationObserver(records => {
      for (const record of records) {
        record.addedNodes.forEach(node => { if (node.nodeType === 1) reveal(node); });
        const counter = record.target.closest?.('#nav-points-val, #shop-wallet-pts');
        if (counter && !counter.classList.contains('wh-value-changed')) {
          counter.classList.add('wh-value-changed');
          counter.addEventListener('animationend', () => counter.classList.remove('wh-value-changed'), { once: true });
        }
      }
    });
    mutations.observe(document.body, { childList: true, subtree: true });
  }

  function stop() {
    puzzleAnimations.forEach(animation => animation.cancel());
    puzzleAnimations = [];
    observer?.disconnect();
    mutations?.disconnect();
    document.querySelectorAll('.wh-reveal, .wh-value-changed').forEach(node => {
      node.classList.remove('wh-reveal', 'is-in-view', 'wh-value-changed');
    });
  }

  preference.addEventListener('change', () => { stop(); start(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
