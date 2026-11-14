/* The Queen tears apart the last question in every chamber. */
(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let dialog;
  let active;
  let timers = [];
  let seenKey;

  function clearScene() {
    timers.forEach(clearTimeout);
    timers = [];
    if (dialog?.open) dialog.close();
    document.body.classList.remove('queen-destroying');
  }

  function finish(focus = true) {
    if (!active) return;
    clearScene();
    document.body.classList.add('queen-system-broken');
    const feedback = document.getElementById('puzzle-feedback');
    if (feedback) {
      feedback.className = 'feedback-banner error show';
      feedback.style.display = 'flex';
      feedback.textContent = 'The Queen destroyed the final riddle. The royal system is still running. Find your own way out.';
    }
    try { sessionStorage.setItem(seenKey, 'seen'); } catch (_) {}
    if (focus) document.getElementById('puzzle-title')?.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('wonderhack:takeover-complete', { detail: active }));
  }

  function buildScene() {
    const base = document.body.dataset.basePath || '../../';
    dialog = document.createElement('dialog');
    dialog.id = 'queen-takeover';
    dialog.className = 'queen-takeover';
    dialog.setAttribute('aria-labelledby', 'takeover-title');
    dialog.setAttribute('aria-describedby', 'takeover-line');
    dialog.innerHTML = `
      <div class="takeover-cracks" aria-hidden="true"></div>
      <div class="takeover-cards" aria-hidden="true">
        <span>Q♥</span><span>A♠</span><span>K♦</span><span>J♣</span>
      </div>
      <div class="takeover-scene">
        <p class="takeover-eyebrow" id="takeover-chamber"></p>
        <div class="takeover-portrait">
          <div class="takeover-halo" aria-hidden="true"></div>
          <img src="${base}assets/images/characters/queen.png" class="takeover-queen" alt="The Queen of Hearts">
        </div>
        <div class="takeover-paper" aria-hidden="true"><span></span><span></span></div>
        <h2 id="takeover-title"></h2>
        <p id="takeover-line" role="status" aria-live="polite"></p>
        <div class="takeover-progress" aria-hidden="true"><span></span></div>
        <button type="button" id="skip-takeover">Skip transition →</button>
      </div>`;
    document.body.append(dialog);
    document.getElementById('skip-takeover').addEventListener('click', () => finish());
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
  }

  function phase(name, title, line) {
    dialog.dataset.phase = name;
    document.getElementById('takeover-title').textContent = title;
    document.getElementById('takeover-line').textContent = line;
    if (!reducedMotion.matches) {
      document.getElementById('takeover-title').animate?.([
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 350, easing: 'ease-out' });
    }
  }

  function onPuzzle(detail) {
    clearScene();
    document.body.classList.remove('queen-system-broken');
    active = detail?.puzzle?.queenCorrupted ? detail : null;
    if (!active) return;
    const player = typeof WonderState !== 'undefined' ? WonderState.getPlayer() : null;
    seenKey = `wh_queen_takeover_v2_${player?.courtId ?? 'guest'}_${detail.difficulty}`;
    let seen = false;
    try { seen = sessionStorage.getItem(seenKey) === 'seen'; } catch (_) {}
    if (seen) { finish(false); return; }
    if (!dialog) buildScene();
    document.getElementById('puzzle-title')?.setAttribute('tabindex', '-1');
    document.getElementById('takeover-chamber').textContent = `${detail.difficulty} chamber / The final trial`;
    dialog.querySelectorAll('.takeover-paper span').forEach(node => { node.textContent = detail.puzzle.question; });
    document.getElementById('skip-takeover').textContent = reducedMotion.matches ? 'Continue →' : 'Skip transition →';
    ['queen-bubble', 'rabbit-bubble'].forEach(id => {
      if (typeof WonderCharacters !== 'undefined') WonderCharacters.hideBubble(id);
    });
    phase('arrival', 'One final riddle remains.', 'You have come far enough, Alice.');
    dialog.showModal();
    document.getElementById('skip-takeover').focus();
    if (reducedMotion.matches) {
      phase('resistance', 'The Queen destroyed the question.', 'The royal system is still running. Find your own way out.');
      return;
    }
    const beat = (delay, action) => timers.push(setTimeout(action, delay));
    beat(1600, () => phase('wrath', 'OFF WITH THE QUESTION!', '“No more riddles. No more escape. My word is law!”'));
    beat(3400, () => {
      phase('destroyed', 'The final riddle is shattered.', 'Her royal seal has torn the question apart.');
      document.body.classList.add('queen-destroying');
      if (typeof WonderAudio !== 'undefined') WonderAudio.playQueenGlitch?.();
    });
    beat(5100, () => phase('resistance', 'Find your own way out.', 'She broke the rules. The secrets of her court are still within reach.'));
    beat(7000, () => finish());
  }

  document.addEventListener('wonderhack:puzzle-loaded', event => onPuzzle(event.detail));
  window.addEventListener('pagehide', clearScene);
  window.addEventListener('pageshow', event => { if (event.persisted && active) onPuzzle(active); });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches && dialog?.open) finish(); });
  window.WonderQueenTakeover = { finish };
})();
