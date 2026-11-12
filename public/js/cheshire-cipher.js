/**
 * WONDERHACK — Cheshire Cat instruction client
 *
 * The cat only teaches the operation order, and only to the Easy chamber.
 * The sealed Easy flag comes from the Easy Chamber console; the player pastes
 * it into the Cipher Lab and performs each layer with the lab's own decoders.
 * This script simply loads the instruction list from the backend — it never
 * receives a cipher value, an intermediate result, or the plaintext flag.
 * A lab opened from Medium or Hard gets no instructions at all.
 *
 *   WonderCheshire.load()  → GET /api/cheshire?from=<difficulty>
 */

const WonderCheshire = (() => {
  const BASE = '';
  let catalog = null;

  function chamberParam() {
    if (typeof window === 'undefined') return '';
    try {
      const params = new URLSearchParams(window.location.search);
      const wanted = (params.get('from') || params.get('difficulty') || '')
        .toLowerCase();
      return ['easy', 'medium', 'hard'].includes(wanted) ? wanted : '';
    } catch (error) {
      return '';
    }
  }

  async function load(force = false) {
    if (catalog && !force) return catalog;
    const chamber = chamberParam();
    try {
      const response = await fetch(
        `${BASE}/api/cheshire${chamber ? `?from=${encodeURIComponent(chamber)}` : ''}`,
        {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        return {
          ok: false,
          status: response.status,
          error: data.error || 'The cat is hiding its instructions.',
        };
      }
      catalog = data;
      return { ok: true, status: response.status, ...data };
    } catch (error) {
      return { ok: false, status: 0, error: 'The Cheshire Cat could not reach the Cipher Lab.' };
    }
  }

  const pub = { load };
  if (typeof window !== 'undefined') window.WonderCheshire = pub;
  return pub;
})();
