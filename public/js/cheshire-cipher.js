/**
 * WONDERHACK — Cheshire Cat instruction client
 *
 * The cat only teaches the operation order. The sealed Easy flag comes from
 * isSolved() in the Easy Chamber console; the player pastes it into the Cipher
 * Lab and performs each layer with the lab's own decoders. This script simply
 * loads the instruction list from the backend — it never receives a cipher
 * value, an intermediate result, or the plaintext flag.
 *
 *   WonderCheshire.load()  → GET /api/cheshire
 */

const WonderCheshire = (() => {
  const BASE = '';
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
        return { ok: false, status: response.status, error: data.error || 'The cat is hiding its instructions.' };
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
