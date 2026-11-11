/**
 * WONDERHACK — Cheshire Cat Cipher Trail client
 *
 * The cat's message is wrapped in four layers. The backend owns the message and
 * the intermediate values; this script only asks for the sealed value and
 * submits one Cipher Lab operation at a time. The Easy flag itself is never
 * part of this trail — it lives behind the console-only isSolved() flaw.
 *
 *   WonderCheshire.load()                     → GET  /api/cheshire
 *   WonderCheshire.advance(step, op, input)   → POST /api/cheshire/advance
 *   WonderCheshire.savedProgress()            → resume the browser's last step
 *   WonderCheshire.saveProgress(progress)
 *   WonderCheshire.clearProgress()
 */

const WonderCheshire = (() => {
  const BASE = '';
  // v2 stores only the cat's non-flag message. The v1 key may contain the old
  // Easy flag, so it is discarded rather than migrated.
  const PROGRESS_KEY = 'wh_cheshire_guide_v2';
  const LEGACY_PROGRESS_KEY = 'wh_cheshire_guide_v1';
  try {
    localStorage.removeItem(LEGACY_PROGRESS_KEY);
  } catch (error) {
    /* private browsing — nothing to clean up */
  }
  let catalog = null;

  async function load(force = false) {
    if (catalog && !force) return catalog;
    try {
      const response = await fetch(`${BASE}/api/cheshire`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        return { ok: false, status: response.status, error: data.error || 'The cat is hiding its cipher.' };
      }
      catalog = data;
      return { ok: true, status: response.status, ...data };
    } catch (error) {
      return { ok: false, status: 0, error: 'The Cheshire Cat could not reach the Cipher Lab.' };
    }
  }

  async function advance(step, operation, input) {
    try {
      const response = await fetch(`${BASE}/api/cheshire/advance`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ step, operation, input }),
      });
      const data = await response.json().catch(() => ({}));
      return {
        ok: response.ok && data.success === true,
        status: response.status,
        error: data.error || '',
        ...data,
      };
    } catch (error) {
      return { ok: false, status: 0, error: 'The Cheshire Cat could not reach the Cipher Lab.' };
    }
  }

  function savedProgress() {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function saveProgress(progress) {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch (error) {
      /* private browsing — the guide still works for this page load */
    }
  }

  function clearProgress() {
    try {
      localStorage.removeItem(PROGRESS_KEY);
    } catch (error) {
      /* ignore */
    }
  }

  const pub = {
    load,
    advance,
    savedProgress,
    saveProgress,
    clearProgress,
    PROGRESS_KEY,
  };
  if (typeof window !== 'undefined') window.WonderCheshire = pub;
  return pub;
})();
