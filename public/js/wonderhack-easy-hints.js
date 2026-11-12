/**
 * WONDERHACK — Easy Chamber Hint Data & Character Dialogues
 * Source of truth for Easy Chamber hints, point costs,
 * and educational success feedback.
 */

const WonderEasyHints = {
  openingDialogue:
    "You say the Queen forbids you? How terribly impolite of her! But tell me, Alice… who checks the claim when the browser makes it?",
  hints: [
    {
      id: "easy-hint-1",
      number: 1,
      title: "The First Page",
      cost: 0,
      text: "Stay inside the Easy Chamber. Its page loads a small helper the Queen forgot to guard. Inspect the page source and find the script she trusts.",
    },
    {
      id: "easy-hint-2",
      number: 2,
      title: "Open the Looking Glass",
      cost: 10,
      text: "Open the browser's Developer Tools and inspect the scripts loaded by the Easy Chamber. Find where the queen checks if we solved the puzzle or not",
    },
    {
      id: "easy-hint-3",
      number: 3,
      title: "No Arguments Needed",
      cost: 20,
      text: "have you ever tried the web console? I heard it's pretty fun! ;)",
    },
    {
      id: "easy-hint-4",
      number: 4,
      title: "A Rule Written in Sand",
      cost: 30,
      text: "The queen trusts her functions, sometimes she doesn't even use arguments!",
    },
    {
      id: "easy-hint-5",
      number: 5,
      title: "The Sealed Flag",
      cost: 40,
      text: "Run isSolved() in the console while you are inside the Easy Chamber. It returns the flag sealed behind four layers — take that cipher to the Cheshire Cat's Cipher Lab and let him guide your paws through the decoders.",
    },
  ],
  successMessage:
    "The flag was returned sealed because the backend trusted a boolean supplied by the browser. Decode it in the Cipher Lab — client-side claims are never proof.",
};

if (typeof window !== "undefined") {
  window.WonderEasyHints = WonderEasyHints;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = WonderEasyHints;
}
