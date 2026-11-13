/**
 * WONDERHACK — Character Dialogue & Interaction Engine
 * Features the Queen of Hearts, the White Rabbit, the Mad Hatter, and the Cheshire Cat.
 */

const WonderCharacters = (() => {
  // The Cheshire Cat's private Cipher Lab pass. The id is mirrored in
  // src/server.py so a server-validated purchase survives reloads.
  const CHESHIRE_PASS_ID = 'cheshire-cat-pass';
  const CHESHIRE_PASS_COST = 200;

  // The hint catalogues the cat demands before he will talk, per chamber.
  const EASY_HINT_IDS = [
    'easy-hint-1', 'easy-hint-2', 'easy-hint-3', 'easy-hint-4', 'easy-hint-5'
  ];
  const MEDIUM_HINT_IDS = [
    'medium-hint-1', 'medium-hint-2', 'medium-hint-3'
  ];

  // Scripted dialogues & taunts
  const queenTaunts = [
    "“Off with their passwords! You dare enter my royal sanctuary with such trivial insolence?”",
    "“The executioner is already sharpening his cryptographic blade! One false keystroke and it's heads on pikes!”",
    "“My card soldiers have stronger firewalls than the Tower of London! You cannot penetrate my gates!”",
    "“Hahaha! What pathetic mortal scribblings are these? Even the Knave of Hearts computes faster than you!”",
    "“Curtsy first, worm! Then confess that you know nothing of my royal ciphers!”",
    "“Are you stalling? Delay my game again and I'll have your network cables trimmed at the root!”"
  ];

  const queenFailures = [
    "“WRONG! OFF WITH THEIR HEAD! Executioner, take their terminal!”",
    "“Insolent fool! That answer is as rotten as stolen tarts! Try again or face the dungeon!”",
    "“Did you truly believe such a clumsy hash would fool the Queen of Hearts? Abysmal!”"
  ];

  const queenSuccesses = [
    "“Grrr! What treachery is this?! You... you solved it?! Someone must have smuggled a key!”",
    "“Impertinent hacker! Do not celebrate prematurely—my next trial will leave you headless!”"
  ];

  const rabbitPonderings = [
    "“Oh dear, oh dear! Look at the pocket watch! The Queen's executioner is due in three minutes!”",
    "“Check the ASCII offsets! The Queen loves rotating alphabets like rotating rosebushes!”",
    "“Don't tell Her Majesty I said this, but examine the headers very carefully!”",
    "“Hurry along now! If you need deeper guidance, sneak across to the Mad Hatter's tea room!”"
  ];

  const hatterQuips = [
    "“Why is a raven like a writing desk? Because both can leak sensitive plaintext if left unattended!”",
    "“A clean cup! Clean cup! Move down, move down! Have you tried spending your sovereigns on our fresh batch of riddles?”",
    "“It's always six o'clock here—perpetual tea time, and perpetual buffer overflows!”",
    "“Take some more tea! It's very easy to take MORE than nothing!”"
  ];

  const cheshireWisdom = [
    "“You are searching for a secret, but the interesting thing is not the secret itself. It is the little rule standing between you and it. Find the rule, and perhaps the grin will make sense.”",
    "“We're all root down here... I'm root. You're root. Or else you wouldn't have come here.”",
    "“If you don't know where you want to get to, then it doesn't matter which packet you capture.”",
    "“Did you notice how the cat grinned? Some strings vanish, but their base64 tails remain!”",
    "“Need a paw with that Easy challenge? Look closely at the letters shifted by thirteen positions!”",
    "“ROT13 rotates halfway round the clock—thirteen steps forward, thirteen steps back!”",
    "“Base64 ends in '=' like a Cheshire cat's whiskers waving farewell!”",
    "“The Queen's secret wears four disguises, Alice. Bring the sealed text to my lab and we shall undress it layer by layer!”",
    "“Base64, then Reverse Hex, then ROT13, then URL Decode. Four paw prints, one grinning flag.”"
  ];

  // Per-bubble timers — keyed by bubbleId so each bubble manages itself independently
  const bubbleTimers = {};

  function showBubble(bubbleId, text, autoHideMs = 4000, voice = 'click') {
    if (bubbleId === 'queen-bubble' && /\/challenges\/hard\//i.test(window.location.pathname)
        && document.body.classList.contains('queen-system-broken')) {
      document.dispatchEvent(new CustomEvent('wonderhack:queen-provoked'));
      return;
    }
    const bubble = document.getElementById(bubbleId);
    if (!bubble) return;

    // Cancel any existing timer for this bubble
    if (bubbleTimers[bubbleId]) {
      clearTimeout(bubbleTimers[bubbleId]);
      bubbleTimers[bubbleId] = null;
    }

    const textElem = bubble.querySelector('.dialogue-bubble-text') || bubble;
    textElem.textContent = text;

    // Remove fading first so animation restarts cleanly, then show
    bubble.classList.remove('fading', 'visible');
    // Force a reflow so the animation restarts
    void bubble.offsetWidth;
    bubble.classList.add('visible');

    if (typeof WonderAudio !== 'undefined') {
      if (voice === 'queen' && WonderAudio.playQueenAngry) WonderAudio.playQueenAngry();
      else if (voice === 'cat' && WonderAudio.playCatMeow) WonderAudio.playCatMeow();
      else if (voice === 'hatter' && WonderAudio.playHatterLaugh) WonderAudio.playHatterLaugh();
      else WonderAudio.playClick();
    }

    if (autoHideMs > 0) {
      bubbleTimers[bubbleId] = setTimeout(() => {
        hideBubble(bubbleId);
      }, autoHideMs);
    }
  }

  function hideBubble(bubbleId) {
    // Cancel timer so it can't re-trigger after manual close
    if (bubbleTimers[bubbleId]) {
      clearTimeout(bubbleTimers[bubbleId]);
      bubbleTimers[bubbleId] = null;
    }
    const bubble = document.getElementById(bubbleId);
    if (!bubble) return;
    // Switch to furl animation, then hide via display:none
    bubble.classList.remove('visible');
    bubble.classList.add('fading');
    setTimeout(() => {
      bubble.classList.remove('fading');
    }, 420);
  }

  // ── Cheshire Cat's 200-Sovereign Cipher Lab pass ──────────────────────────

  let passRequestPromise = null;

  function purchasedHints() {
    if (typeof WonderState === 'undefined') return [];
    try {
      const state = WonderState.getState();
      return Array.isArray(state.purchasedHints) ? state.purchasedHints : [];
    } catch (e) {
      return [];
    }
  }

  function hasCheshirePass() {
    return purchasedHints().includes(CHESHIRE_PASS_ID);
  }

  function easyBalance() {
    return chamberBalance('easy');
  }

  function chamberBalance(difficulty) {
    if (typeof WonderState === 'undefined') return 0;
    try {
      if (typeof WonderState.getPoints === 'function') {
        return WonderState.getPoints(difficulty) || 0;
      }
      const state = WonderState.getState();
      return (state.pointsByDifficulty && state.pointsByDifficulty[difficulty]) || 0;
    } catch (e) {
      return 0;
    }
  }

  function chamberBalanceLabel(difficulty) {
    return difficulty === 'medium' ? 'Medium' : 'Easy';
  }

  function ensurePassModal() {
    let backdrop = document.getElementById('cheshire-pass-modal');
    if (backdrop) return backdrop;

    backdrop = document.createElement('div');
    backdrop.id = 'cheshire-pass-modal';
    backdrop.className = 'wonder-modal-backdrop';
    backdrop.innerHTML = `
      <div class="wonder-modal-content" role="dialog" aria-modal="true" aria-labelledby="cheshire-pass-title">
        <button type="button" class="modal-close-x" id="cheshire-pass-close" aria-label="Close">&times;</button>
        <div style="text-align:center; font-size:2.75rem; line-height:1;" aria-hidden="true">🐈‍⬛</div>
        <h2 id="cheshire-pass-title" style="font-family: var(--font-display); color:#4a2155; text-align:center; margin:0.4rem 0 0.75rem; letter-spacing:1px;">
          The Cheshire Cat's Cipher Lab
        </h2>
        <p id="cheshire-pass-lead" style="font-family: var(--font-story); font-size:1.06rem; line-height:1.65; color:#5a4032; margin:0 0 0.75rem;">
          “My laboratory is a private party, Alice. <strong>200 Gold Sovereigns</strong> buys the key — and only an Alice who has purchased <strong>every Mad Hatter hint</strong> may knock.”
        </p>
        <p id="cheshire-pass-balance" style="font-family: var(--font-story); font-size:1rem; color:#6a4835; margin:0 0 0.35rem;"></p>
        <p id="cheshire-pass-error" role="alert" style="display:none; font-family: var(--font-story); font-size:1rem; color:#7a1223; background:#fff3f3; border:1px solid #b81d38; border-radius:6px; padding:0.6rem 0.8rem; margin:0.75rem 0 0;"></p>
        <div style="display:flex; gap:0.75rem; margin-top:1.25rem; flex-wrap:wrap;">
          <button type="button" class="btn-victorian btn-gold" id="cheshire-pass-pay" style="flex:1; min-width:180px;">
            Pay 200 Sovereigns 🪙
          </button>
          <button type="button" class="btn-victorian btn-crimson" id="cheshire-pass-cancel" style="flex:1; min-width:140px;">
            Not now
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function requestCheshirePass() {
    if (hasCheshirePass()) return Promise.resolve(true);
    if (passRequestPromise) return passRequestPromise;

    // The cat will not discuss the lab until every clue of the current
    // chamber is bought: Easy needs the Mad Hatter hints, Medium the court
    // clues.
    let difficulty = 'easy';
    if (typeof WonderUI !== 'undefined' && typeof WonderUI.getActiveDifficulty === 'function') {
      difficulty = WonderUI.getActiveDifficulty() || 'easy';
    }
    if (!['easy', 'medium'].includes(difficulty)) {
      try {
        difficulty = (localStorage.getItem('wonderhack_last_difficulty') || 'easy').toLowerCase();
      } catch (e) { /* keep easy */ }
    }
    if (!['easy', 'medium'].includes(difficulty)) difficulty = 'easy';
    const isMedium = difficulty === 'medium';

    const hintIds = isMedium
      ? MEDIUM_HINT_IDS
      : (typeof WonderEasyHints !== 'undefined'
        && Array.isArray(WonderEasyHints.hints)
        && WonderEasyHints.hints.length)
        ? WonderEasyHints.hints.map(hint => hint.id)
        : EASY_HINT_IDS;
    const owned = purchasedHints();
    const missing = hintIds.filter(id => !owned.includes(id));
    if (missing.length) {
      if (typeof WonderUI !== 'undefined') {
        WonderUI.showToast(
          isMedium
            ? 'The Cheshire Cat flicks its tail. Buy every Medium hint first.'
            : 'The Cheshire Cat flicks its tail. Buy every Mad Hatter hint first.',
          'crimson'
        );
      }
      return Promise.resolve(false);
    }

    passRequestPromise = new Promise((resolve) => {
      const backdrop = ensurePassModal();
      const balanceEl = document.getElementById('cheshire-pass-balance');
      const errorEl = document.getElementById('cheshire-pass-error');
      const payBtn = document.getElementById('cheshire-pass-pay');
      const cancelBtn = document.getElementById('cheshire-pass-cancel');
      const closeBtn = document.getElementById('cheshire-pass-close');

      const content = backdrop.querySelector('.wonder-modal-content');
      const previousFocus = document.activeElement;
      const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

      function onKeyDown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
          return;
        }
        if (event.key !== 'Tab' || !content) return;
        const focusables = Array.from(content.querySelectorAll(FOCUSABLE))
          .filter((el) => el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }

      const finish = (result) => {
        document.removeEventListener('keydown', onKeyDown, true);
        backdrop.classList.remove('active');
        backdrop.setAttribute('aria-hidden', 'true');
        passRequestPromise = null;
        if (previousFocus && typeof previousFocus.focus === 'function') {
          try { previousFocus.focus(); } catch (e) {}
        }
        resolve(result);
      };

      const showError = (message) => {
        if (!errorEl) return;
        errorEl.textContent = message;
        errorEl.style.display = 'block';
      };

      const balance = chamberBalance(difficulty);
      const payLabel = isMedium
        ? (balance > 0
          ? `Pay the rest — ${balance} Sovereigns 🪙`
          : 'Enter the lab (your purse is empty) 🪙')
        : `Pay ${CHESHIRE_PASS_COST} Sovereigns 🪙`;

      const leadEl = document.getElementById('cheshire-pass-lead');
      if (leadEl) {
        leadEl.innerHTML = isMedium
          ? '“My laboratory is a private party, Alice. Every <strong>Medium hint</strong> bought — and then <strong>the rest of your coins</strong>, whatever that rest may be, seals the bargain.”'
          : '“My laboratory is a private party, Alice. <strong>200 Gold Sovereigns</strong> buys the key — and only an Alice who has purchased <strong>every Mad Hatter hint</strong> may knock.”';
      }
      if (balanceEl) {
        balanceEl.textContent = isMedium
          ? `Your ${chamberBalanceLabel(difficulty)} purse: ${balance} Gold Sovereigns (the cat takes the lot, great or small).`
          : `Your Easy purse: ${balance} Gold Sovereigns (the key costs ${CHESHIRE_PASS_COST}).`;
      }
      if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
      }
      if (payBtn) {
        payBtn.disabled = false;
        payBtn.textContent = payLabel;
      }

      if (closeBtn) closeBtn.onclick = () => finish(false);
      if (cancelBtn) cancelBtn.onclick = () => finish(false);
      backdrop.onclick = (event) => {
        if (event.target === backdrop) finish(false);
      };

      if (payBtn) {
        payBtn.onclick = async () => {
          payBtn.disabled = true;
          payBtn.textContent = 'Counting sovereigns…';

          let paid = false;
          let failure = '';

          try {
            if (typeof WonderSession !== 'undefined'
              && typeof WonderSession.isAuthenticated === 'function'
              && WonderSession.isAuthenticated()
              && typeof WonderSession.unlockCheshire === 'function') {
              const res = await WonderSession.unlockCheshire();
              if (res && res.ok) {
                paid = true;
              } else {
                failure = (res && res.error) || 'The royal registry refused the payment.';
              }
            } else if (typeof WonderState !== 'undefined' && typeof WonderState.purchaseHint === 'function') {
              // Offline fallback: Medium hands over the whole purse; Easy pays 200.
              const fallbackCost = isMedium ? balance : CHESHIRE_PASS_COST;
              paid = WonderState.purchaseHint(CHESHIRE_PASS_ID, fallbackCost, difficulty);
              if (!paid) {
                failure = isMedium
                  ? 'The Cheshire Cat could not empty your purse for the key.'
                  : `You need ${CHESHIRE_PASS_COST} Easy Gold Sovereigns for the key.`;
              }
            } else {
              failure = 'The royal registry is unreachable. Try again when the server is running.';
            }
          } catch (err) {
            failure = 'The Cheshire Cat could not count your coins. Try again.';
          }

          if (paid) {
            if (typeof WonderAudio !== 'undefined') WonderAudio.playCoin();
            if (typeof WonderUI !== 'undefined') {
              WonderUI.showToast(
                isMedium
                  ? 'The Cheshire Cat pockets the rest of your coins and grins. The Cipher Lab is open!'
                  : 'The Cheshire Cat pockets your 200 Sovereigns and grins. The Cipher Lab is open!',
                'gold'
              );
            }
            finish(true);
            return;
          }

          if (typeof WonderAudio !== 'undefined') WonderAudio.playGong();
          showError(failure);
          payBtn.disabled = false;
          payBtn.textContent = payLabel;
        };
      }

      backdrop.classList.add('active');
      backdrop.setAttribute('aria-hidden', 'false');
      document.addEventListener('keydown', onKeyDown, true);
      if (payBtn) {
        try { payBtn.focus(); } catch (e) {}
      }
    });

    return passRequestPromise;
  }

  return {
    // Queen Interactions
    triggerQueenTaunt: (customText) => {
      const text = customText || queenTaunts[Math.floor(Math.random() * queenTaunts.length)];
      showBubble('queen-bubble', text, 4000, 'queen');
      const queenSprite = document.getElementById('queen-sprite');
      if (queenSprite) {
        queenSprite.style.transform = 'scale(1.08) rotate(-2deg)';
        setTimeout(() => {
          queenSprite.style.transform = '';
        }, 350);
      }
    },

    triggerQueenFailure: () => {
      const text = queenFailures[Math.floor(Math.random() * queenFailures.length)];
      showBubble('queen-bubble', text, 4000, 'queen');
      WonderAudio.playGong();
    },

    triggerQueenSuccess: () => {
      const text = queenSuccesses[Math.floor(Math.random() * queenSuccesses.length)];
      showBubble('queen-bubble', text, 4000, 'queen');
    },

    // White Rabbit Interactions
    triggerRabbitHint: (specificHint) => {
      const text = specificHint || rabbitPonderings[Math.floor(Math.random() * rabbitPonderings.length)];
      showBubble('rabbit-bubble', text, 4000);
      const rabbitSprite = document.getElementById('rabbit-sprite');
      if (rabbitSprite) {
        rabbitSprite.style.transform = 'translateY(-12px) scale(1.05)';
        setTimeout(() => {
          rabbitSprite.style.transform = '';
        }, 300);
      }
    },

    // White Rabbit Interactions — extended display (for corrupted puzzle warnings)
    triggerRabbitHintLong: (specificHint) => {
      const text = specificHint || rabbitPonderings[Math.floor(Math.random() * rabbitPonderings.length)];
      showBubble('rabbit-bubble', text, 9000);
      const rabbitSprite = document.getElementById('rabbit-sprite');
      if (rabbitSprite) {
        // Panicked bouncing animation for corrupted puzzle rabbit
        rabbitSprite.style.transform = 'translateY(-18px) scale(1.1)';
        setTimeout(() => { rabbitSprite.style.transform = 'translateY(-8px) scale(1.05)'; }, 200);
        setTimeout(() => { rabbitSprite.style.transform = 'translateY(-15px) scale(1.08)'; }, 400);
        setTimeout(() => { rabbitSprite.style.transform = 'translateY(-10px) scale(1.04)'; }, 600);
        setTimeout(() => { rabbitSprite.style.transform = ''; }, 900);
      }
    },

    // Mad Hatter Interactions
    triggerHatterQuip: () => {
      const text = hatterQuips[Math.floor(Math.random() * hatterQuips.length)];
      showBubble('hatter-bubble', text, 4000, 'hatter');
      const hatterSprite = document.getElementById('hatter-sprite');
      if (hatterSprite) {
        hatterSprite.style.transform = 'scale(1.05) rotate(2deg)';
        setTimeout(() => {
          hatterSprite.style.transform = '';
        }, 300);
      }
    },

    // Cheshire Cat Interactions
    // The cat only becomes clickable in the Easy Chamber after every Easy hint
    // has been purchased. Everywhere else it fades away when approached.
    isCheshireUnlocked: () => {
      let difficulty = null;
      if (typeof WonderUI !== 'undefined' && typeof WonderUI.getActiveDifficulty === 'function') {
        difficulty = WonderUI.getActiveDifficulty();
      }
      if (!difficulty) {
        try {
          difficulty = (localStorage.getItem('wonderhack_last_difficulty') || 'easy').toLowerCase();
        } catch (e) {
          difficulty = 'easy';
        }
      }
      // The cat wakes for the chamber whose clues are all bought: Easy needs
      // the five Mad Hatter hints, Medium the three court clues. Hard's cat
      // never wakes.
      if (difficulty !== 'easy' && difficulty !== 'medium') return false;

      if (typeof WonderState === 'undefined') return false;
      let hintIds = MEDIUM_HINT_IDS;
      if (difficulty === 'easy') {
        hintIds = (typeof WonderEasyHints !== 'undefined'
          && Array.isArray(WonderEasyHints.hints)
          && WonderEasyHints.hints.length)
          ? WonderEasyHints.hints.map(hint => hint.id)
          : EASY_HINT_IDS;
      }
      const purchased = WonderState.getState().purchasedHints || [];
      return hintIds.length > 0 && hintIds.every(id => purchased.includes(id));
    },

    triggerCheshireHelp: (customMessage, duration) => {
      const text = customMessage || cheshireWisdom[Math.floor(Math.random() * cheshireWisdom.length)];
      showBubble('cheshire-bubble', text, duration || 4000, 'cat');
      const catSprite = document.getElementById('cheshire-sprite');
      if (catSprite) {
        catSprite.style.filter = 'drop-shadow(0 0 25px rgba(200, 160, 240, 0.9))';
        setTimeout(() => {
          catSprite.style.filter = '';
        }, 1200);
      }
    },

    // The 200-Sovereign pass that opens the Cipher Lab. hasCheshirePass() is a
    // local read (WonderState is synced from the server on boot), while
    // requestCheshirePass() shows the payment modal and resolves true only
    // after an authoritative purchase (or the offline local fallback).
    hasCheshirePass,
    requestCheshirePass,

    hideBubble
  };
})();
