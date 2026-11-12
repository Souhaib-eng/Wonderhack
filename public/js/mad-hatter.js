/**
 * WONDERHACK — Mad Hatter's Tea Room Controller
 * Manages hint progression, purchases, wallet updates, and character interactions.
 * In Easy Chamber, Mad Hatter offers 5 progressive hints (Hint 1 is free, Hints 2–5 cost points),
 * and Cheshire Cat provides a free extra hint.
 * In Medium and Hard Chambers, the shop remains empty.
 */

const WonderHatterShop = (() => {
  let activeDifficulty = 'easy';

  function getChamberDifficulty() {
    const urlParams = new URLSearchParams(window.location.search);
    const fromParam = urlParams.get('from') || urlParams.get('difficulty');
    if (fromParam && ['easy', 'medium', 'hard'].includes(fromParam.toLowerCase())) {
      return fromParam.toLowerCase();
    }
    const savedDiff = localStorage.getItem('wh_last_difficulty')
      || localStorage.getItem('wonderhack_last_difficulty');
    if (savedDiff && ['easy', 'medium', 'hard'].includes(savedDiff.toLowerCase())) {
      return savedDiff.toLowerCase();
    }
    return 'easy';
  }

  function setupBackButton() {
    const returnBtn = document.getElementById('shop-return-btn') || document.querySelector('.shop-return-btn');
    if (!returnBtn) return;

    let target = 'challenges/easy/index.html';
    if (activeDifficulty && ['easy', 'medium', 'hard'].includes(activeDifficulty)) {
      target = `challenges/${activeDifficulty}/index.html`;
    }

    returnBtn.href = target;
    returnBtn.setAttribute('title', 'Return to Puzzles');
    returnBtn.innerHTML = '<span>←</span> <strong>Back to Puzzles</strong>';

    returnBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = target;
    });
  }

  function updateWalletDisplay() {
    const walletElem = document.getElementById('shop-wallet-pts');
    if (!walletElem) return;
    const pts = (typeof WonderState !== 'undefined') ? (WonderState.getState().points || 0) : 0;
    walletElem.textContent = pts;
  }

  function renderHints() {
    const grid = document.getElementById('hints-grid');
    if (!grid) return;

    const data = (typeof WonderEasyHints !== 'undefined') ? WonderEasyHints : null;
    if (!data || !Array.isArray(data.hints)) {
      grid.innerHTML = '<p style="font-family: var(--font-story); color:#7a1223;">Hints are currently brewing…</p>';
      return;
    }

    const state = (typeof WonderState !== 'undefined') ? WonderState.getState() : { points: 0, purchasedHints: [] };
    const walletPts = state.points || 0;
    const purchased = state.purchasedHints || [];

    grid.innerHTML = data.hints.map((hint, idx) => {
      const isPurchased = purchased.includes(hint.id);
      // Sequential progression: hint 1 is always accessible; subsequent hints require previous hint unlocked
      const prevUnlocked = idx === 0 || purchased.includes(data.hints[idx - 1].id);
      const isLocked = !isPurchased;
      const canAfford = walletPts >= hint.cost;

      let cardClass = 'hint-card';
      if (isPurchased) cardClass += ' unlocked';

      let costPillHtml = '';
      if (isPurchased) {
        costPillHtml = '<span class="hint-cost-pill" style="color:#25612c; background:rgba(37,97,44,0.15); border-color:rgba(37,97,44,0.4);">Purchased ✓</span>';
      } else if (hint.cost === 0) {
        costPillHtml = '<span class="hint-cost-pill" style="color:#7a3010; background:rgba(212,175,55,0.2); border-color:rgba(197,155,39,0.5);">Free Clue (0 🪙)</span>';
      } else {
        costPillHtml = `<span class="hint-cost-pill">${hint.cost} Sovereigns 🪙</span>`;
      }

      let bodyHtml = '';
      if (isPurchased) {
        bodyHtml = `
          <div class="hint-card-body">
            <div class="hint-unlocked-content">“${hint.text}”</div>
            <p style="margin: 0.65rem 0 0 0; font-family: var(--font-story); font-size: 0.95rem; color: #6a4835; font-style: italic;">
              <strong>Learning Goal:</strong> ${hint.learningGoal}
            </p>
          </div>
        `;
      } else {
        bodyHtml = `
          <div class="hint-card-body locked">
            <p style="margin: 0 0 0.5rem 0;">
              🔒 <em>A secret kept beneath the Mad Hatter's tea cozy. Purchase to reveal this clue.</em>
            </p>
            <p style="margin: 0; font-family: var(--font-story); font-size: 0.95rem; color: #7d6b5e;">
              <strong>Learning Goal:</strong> ${hint.learningGoal}
            </p>
          </div>
        `;
      }

      let actionHtml = '';
      if (isPurchased) {
        actionHtml = `
          <button type="button" class="btn-victorian btn-gold" disabled style="opacity:0.9; cursor:default;">
            Revealed ✓
          </button>
        `;
      } else if (!prevUnlocked) {
        actionHtml = `
          <button type="button" class="btn-victorian" disabled style="opacity:0.45; cursor:not-allowed;" title="Unlock Hint ${idx} first">
            🔒 Unlock Hint ${idx} First
          </button>
        `;
      } else if (hint.cost === 0) {
        actionHtml = `
          <button type="button" class="btn-victorian btn-gold buy-hint-btn" data-hint-id="${hint.id}" data-cost="0">
            Reveal Free Clue ➔
          </button>
        `;
      } else if (!canAfford) {
        actionHtml = `
          <button type="button" class="btn-victorian btn-crimson buy-hint-btn disabled" data-hint-id="${hint.id}" data-cost="${hint.cost}" style="opacity:0.65;" title="You need more Sovereigns!">
            Need ${hint.cost} Sovereigns (${walletPts} available)
          </button>
        `;
      } else {
        actionHtml = `
          <button type="button" class="btn-victorian btn-crimson buy-hint-btn" data-hint-id="${hint.id}" data-cost="${hint.cost}">
            Purchase Hint (${hint.cost} Sovereigns 🪙)
          </button>
        `;
      }

      return `
        <article class="${cardClass}" id="card-${hint.id}">
          <header class="hint-card-header">
            <div>
              <span class="hint-card-badge">Easy Chamber · Clue ${hint.number}</span>
              <h2 class="hint-card-title">${hint.title}</h2>
            </div>
            ${costPillHtml}
          </header>
          ${bodyHtml}
          <div class="hint-card-actions">
            ${actionHtml}
          </div>
        </article>
      `;
    }).join('');

    // Bind purchase buttons
    grid.querySelectorAll('.buy-hint-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const hintId = e.currentTarget.dataset.hintId;
        const cost = parseInt(e.currentTarget.dataset.cost, 10) || 0;
        await purchaseHint(hintId, cost);
      });
    });
  }

  async function purchaseHint(hintId, cost) {
    if (typeof WonderState === 'undefined') return;

    if (WonderState.isHintPurchased(hintId)) {
      if (typeof WonderUI !== 'undefined') WonderUI.showToast('You already possess this secret!', 'gold');
      return;
    }

    const state = WonderState.getState();
    const currentPts = state.points || 0;

    if (cost > 0 && currentPts < cost) {
      if (typeof WonderAudio !== 'undefined') WonderAudio.playGong();
      if (typeof WonderUI !== 'undefined') {
        WonderUI.showToast(`Alas! You need ${cost} Gold Sovereigns to purchase this secret!`, 'crimson');
      }
      return;
    }

    // Attempt authoritative purchase via server if session is online
    let serverSuccess = false;
    if (typeof WonderSession !== 'undefined' && WonderSession.isAuthenticated && WonderSession.isAuthenticated()) {
      try {
        const res = await WonderSession.buyHint(hintId);
        if (res && res.ok) {
          serverSuccess = true;
        } else if (res && res.error) {
          if (typeof WonderAudio !== 'undefined') WonderAudio.playGong();
          if (typeof WonderUI !== 'undefined') WonderUI.showToast(res.error, 'crimson');
          return;
        }
      } catch (err) {
        console.warn('WonderHatterShop: Server purchase error, falling back locally', err);
      }
    }

    // Local state fallback / synchronization
    if (!serverSuccess) {
      const ok = WonderState.purchaseHint(hintId, cost, 'easy');
      if (!ok) return;
    } else {
      if (typeof WonderAudio !== 'undefined') WonderAudio.playCoin();
      const diffTag = cost > 0 ? ` -${cost} Sovereigns` : ' (Free Clue)';
      if (typeof WonderUI !== 'undefined') WonderUI.showToast(`Hint unlocked!${diffTag}`, 'gold');
    }

    updateWalletDisplay();
    renderHints();
    refreshCheshireCat();
  }

  let cheshireVanishTimer = null;

  function catUnlocked() {
    return (
      typeof WonderCharacters !== 'undefined'
      && typeof WonderCharacters.isCheshireUnlocked === 'function'
      && WonderCharacters.isCheshireUnlocked()
    );
  }

  // The cat becomes clickable only when every Easy hint has been purchased.
  // Re-run this after each purchase so the change happens without a reload.
  function refreshCheshireCat() {
    const cheshireSprite = document.getElementById('cheshire-sprite');
    if (!cheshireSprite) return;
    const unlocked = catUnlocked();
    const hasPass = typeof WonderCharacters !== 'undefined'
      && typeof WonderCharacters.hasCheshirePass === 'function'
      && WonderCharacters.hasCheshirePass();
    cheshireSprite.classList.toggle('cat-locked', !unlocked);
    cheshireSprite.classList.remove('is-vanished');
    if (!unlocked) {
      cheshireSprite.title = 'The Cheshire Cat appears only after every Easy hint is purchased';
    } else if (!hasPass) {
      cheshireSprite.title = 'Click the Cheshire Cat to pay 200 Sovereigns for the Cipher Lab';
    } else {
      cheshireSprite.title = "Click the Cheshire Cat to enter the Queen's Cipher Laboratory";
    }
    cheshireSprite.setAttribute('aria-disabled', unlocked ? 'false' : 'true');
    cheshireSprite.setAttribute(
      'aria-label',
      unlocked
        ? (hasPass
          ? "The Cheshire Cat. Activate to enter the Queen's Cipher Laboratory."
          : 'The Cheshire Cat. Activate to purchase the Cipher Lab pass.')
        : 'The Cheshire Cat is asleep until every Easy hint is purchased.'
    );
    clearTimeout(cheshireVanishTimer);
  }

  function bindInteractions() {
    // Mad Hatter sprite click
    const hatterSprite = document.getElementById('hatter-sprite');
    if (hatterSprite) {
      hatterSprite.addEventListener('click', () => {
        if (activeDifficulty === 'easy' && typeof WonderEasyHints !== 'undefined') {
          const bubble = document.getElementById('hatter-bubble');
          if (bubble) {
            const textElem = bubble.querySelector('.dialogue-bubble-text') || bubble;
            textElem.textContent = WonderEasyHints.openingDialogue;
            bubble.classList.remove('fading', 'visible');
            void bubble.offsetWidth;
            bubble.classList.add('visible');
            if (typeof WonderAudio !== 'undefined') {
              if (WonderAudio.playHatterLaugh) WonderAudio.playHatterLaugh();
              else WonderAudio.playClick();
            }
          }
        } else if (typeof WonderCharacters !== 'undefined' && WonderCharacters.triggerHatterQuip) {
          WonderCharacters.triggerHatterQuip();
        } else if (typeof WonderAudio !== 'undefined') {
          // The tea table always giggles, even without the shared characters module.
          if (WonderAudio.playHatterLaugh) WonderAudio.playHatterLaugh();
          else if (WonderAudio.playClick) WonderAudio.playClick();
        }
      });
    }

    // Cheshire Cat sprite click → Cipher Lab.
    // The cat is only clickable after every Easy hint has been purchased.
    // Before that (and in Medium/Hard) it fades away and ignores clicks.
    const cheshireSprite = document.getElementById('cheshire-sprite');

    if (cheshireSprite) {
      const openCipherLab = async () => {
        // A meow greets every click, even before the cat wakes up.
        if (typeof WonderAudio !== 'undefined') {
          if (WonderAudio.playCatMeow) WonderAudio.playCatMeow();
          else WonderAudio.playClick();
        }
        if (!catUnlocked()) return;

        // The cat is visible after every Easy hint, but the laboratory is a
        // private party: the 200-Sovereign key must be paid first.
        let hasPass = typeof WonderCharacters !== 'undefined'
          && typeof WonderCharacters.hasCheshirePass === 'function'
          && WonderCharacters.hasCheshirePass();
        if (!hasPass && typeof WonderCharacters !== 'undefined'
          && typeof WonderCharacters.requestCheshirePass === 'function') {
          hasPass = await WonderCharacters.requestCheshirePass();
        }
        if (!hasPass) return;

        refreshCheshireCat();
        const diff = (activeDifficulty || 'easy').toLowerCase();
        window.location.href = `challenge.html?from=${encodeURIComponent(diff)}`;
      };

      cheshireSprite.addEventListener('mouseenter', () => {
        if (catUnlocked()) return;
        clearTimeout(cheshireVanishTimer);
        cheshireVanishTimer = setTimeout(() => {
          cheshireSprite.classList.add('is-vanished');
        }, 200); // matches the CSS fade duration
      });

      cheshireSprite.addEventListener('mouseleave', () => {
        if (catUnlocked()) return;
        clearTimeout(cheshireVanishTimer);
        cheshireSprite.classList.remove('is-vanished');
      });

      cheshireSprite.addEventListener('click', (e) => {
        e.stopPropagation();
        openCipherLab();
      });

      cheshireSprite.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          openCipherLab();
        }
      });

      refreshCheshireCat();
    }

    // Speech bubble close buttons
    document.querySelectorAll('.dialogue-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const bubble = e.target.closest('.dialogue-bubble');
        if (bubble) bubble.classList.remove('visible');
      });
    });

    // Keep the wallet in sync with global state
    if (typeof WonderState !== 'undefined') {
      WonderState.subscribe(() => {
        updateWalletDisplay();
      });
    }
  }

  function init() {
    activeDifficulty = getChamberDifficulty();
    setupBackButton();
    bindInteractions();
    updateWalletDisplay();

    const emptySection = document.getElementById('shop-empty');
    const easyContainer = document.getElementById('easy-hints-container');

    if (activeDifficulty === 'easy') {
      if (emptySection) emptySection.style.display = 'none';
      if (easyContainer) easyContainer.style.display = 'block';

      // Update Mad Hatter speech bubble to Easy opening dialogue
      const hatterBubbleText = document.querySelector('#hatter-bubble .dialogue-bubble-text');
      if (hatterBubbleText && typeof WonderEasyHints !== 'undefined') {
        hatterBubbleText.textContent = WonderEasyHints.openingDialogue;
      }

      // Update Cheshire Cat speech bubble and assist box to the free extra hint
      if (typeof WonderEasyHints !== 'undefined') {
        const cheshireBubbleText = document.querySelector('#cheshire-bubble .dialogue-bubble-text');
        if (cheshireBubbleText) {
          cheshireBubbleText.textContent = `“${WonderEasyHints.cheshireHint.text}”`;
        }
        const cheshireHintText = document.getElementById('cheshire-hint-text');
        if (cheshireHintText) {
          cheshireHintText.textContent = `“${WonderEasyHints.cheshireHint.text}”`;
        }
      }

      renderHints();
    } else {
      // Medium / Hard: preserve empty tea table
      if (easyContainer) easyContainer.style.display = 'none';
      if (emptySection) emptySection.style.display = 'block';
    }

    // Refresh the cat lock after the shop and session state are ready.
    refreshCheshireCat();
  }

  return {
    init,
    renderHints,
    purchaseHint
  };
})();
