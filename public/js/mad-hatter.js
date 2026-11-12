/**
 * WONDERHACK — Mad Hatter's Tea Room Controller
 * Manages hint progression, purchases, wallet updates, and character interactions.
 *
 * The chamber the player came from is read from the request's Referer (the page
 * they clicked "Visit Shop" on), so the shop always shows that chamber's own
 * clues. Easy offers 5 progressive hints; Medium offers the three paid clues the
 * Queen's court keeps. Hard has nothing for sale.
 */

const WonderHatterShop = (() => {
  let activeDifficulty = 'easy';

  // Medium Chamber hint catalogue. Prices are paid from the Medium coin purse.
  // This is the offline fallback: when the game is served by server.py the shop
  // fetches /api/hints, which is authoritative for the chamber and prices.
  const MEDIUM_HINTS = {
    openingDialogue:
      "“Ah, the Royal Court! The Queen's secrets are steeped stronger than my tea, Alice.”",
    hints: [
      {
        id: 'medium-hint-1',
        number: 1,
        title: "The Queen's Account",
        cost: 200,
        text: "I heard from the Cheshire Cat that the flag is in the queen's account.",
      },
      {
        id: 'medium-hint-2',
        number: 2,
        title: 'Cold Soft Quiet Nights',
        cost: 300,
        text: 'I really like the cold Soft Quiet nights, the moon and its Light really helps me relax!',
      },
      {
        id: 'medium-hint-3',
        number: 3,
        title: "The Queen's Username",
        cost: 0,
        text: "The Queen's username is 'hearts_queen'.",
      },
    ],
  };

  const DIFFICULTY_LABELS = {
    easy: 'Easy Chamber',
    medium: 'Medium Chamber',
    hard: 'Hard Chamber',
  };

  function hintCatalog() {
    if (activeDifficulty === 'medium') return MEDIUM_HINTS;
    if (activeDifficulty === 'easy' && typeof WonderEasyHints !== 'undefined') {
      return WonderEasyHints;
    }
    return null;
  }

  /**
   * Ask the backend for the hint catalogue of the active chamber.
   *
   * The Mad Hatter page can be opened directly (or after a stale reload), so
   * `?from=` and the saved difficulty in localStorage are not enough to trust:
   * the referer of the *page* is the chamber the player came from, and the
   * server answers only with that chamber's hints. This is what stops the shop
   * from showing the Easy clues while the player stands in the Medium chamber
   * (the "Unknown hints for this chamber" dead end).
   *
   * Falls back to the local catalogue when the API is not reachable.
   */
  async function loadCatalog() {
    const local = hintCatalog();
    if (typeof WonderSession === 'undefined') return local;
    try {
      const res = await fetch('/api/hints', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) return local;
      const data = await res.json();
      if (!data || data.success !== true || !Array.isArray(data.hints)) {
        return local;
      }
      const diff = String(data.difficulty || '').toLowerCase();
      if (!['easy', 'medium', 'hard'].includes(diff)) return local;
      // The server is authoritative for the chamber the request came from.
      activeDifficulty = diff;
      return {
        difficulty: diff,
        openingDialogue: data.openingDialogue || '',
        hints: data.hints,
      };
    } catch (err) {
      return local;
    }
  }

  function chamberPoints() {
    if (typeof WonderState === 'undefined') return 0;
    if (typeof WonderState.getPoints === 'function') {
      return WonderState.getPoints(activeDifficulty) || 0;
    }
    const state = WonderState.getState();
    return (state.pointsByDifficulty && state.pointsByDifficulty[activeDifficulty]) || 0;
  }

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
    walletElem.textContent = chamberPoints();
  }

  // The hint catalogue can arrive from the backend (authoritative) or from the
  // local fallback files. The last loaded value is remembered so a later
  // purchase re-render does not need another round trip.
  let loadedCatalog = null;

  function renderHints() {
    const grid = document.getElementById('hints-grid');
    if (!grid) return;

    const data = loadedCatalog || hintCatalog();
    if (!data || !Array.isArray(data.hints)) {
      grid.innerHTML = '<p style="font-family: var(--font-story); color:#7a1223;">Hints are currently brewing…</p>';
      return;
    }

    const state = (typeof WonderState !== 'undefined') ? WonderState.getState() : { purchasedHints: [] };
    const walletPts = chamberPoints();
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
          </div>
        `;
      } else {
        bodyHtml = `
          <div class="hint-card-body locked">
            <p style="margin: 0 0 0.5rem 0;">
              🔒 <em>A secret kept beneath the Mad Hatter's tea cozy. Purchase to reveal this clue.</em>
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
              <span class="hint-card-badge">${DIFFICULTY_LABELS[activeDifficulty] || 'Royal'} · Clue ${hint.number}</span>
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

    const currentPts = chamberPoints();

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
      const ok = WonderState.purchaseHint(hintId, cost, activeDifficulty);
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

  async function init() {
    activeDifficulty = getChamberDifficulty();

    // Ask the server first (the request's Referer identifies the chamber), then
    // render with the local catalogue if the API is unavailable. The backend is
    // authoritative for which chamber the shop is showing, so the back button
    // and wallet are set up only after it answers.
    const catalog = await loadCatalog();
    loadedCatalog = catalog;

    setupBackButton();
    bindInteractions();
    updateWalletDisplay();

    const emptySection = document.getElementById('shop-empty');
    const hintsContainer = document.getElementById('hints-container');

    if (catalog && Array.isArray(catalog.hints) && catalog.hints.length) {
      if (emptySection) emptySection.style.display = 'none';
      if (hintsContainer) hintsContainer.style.display = 'block';

      // Update Mad Hatter speech bubble to the chamber's opening dialogue
      const hatterBubbleText = document.querySelector('#hatter-bubble .dialogue-bubble-text');
      if (hatterBubbleText && catalog.openingDialogue) {
        hatterBubbleText.textContent = catalog.openingDialogue;
      }
      const introText = document.getElementById('hatter-intro-text');
      if (introText && catalog.openingDialogue) {
        introText.textContent = catalog.openingDialogue;
      }

      // The cat no longer offers a free extra hint in the hint area.
      renderHints();
    } else {
      // Hard: preserve the empty tea table
      if (hintsContainer) hintsContainer.style.display = 'none';
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
