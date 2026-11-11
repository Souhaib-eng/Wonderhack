/**
 * WONDERHACK — Easy Chamber Hint Data & Character Dialogues
 * Source of truth for Easy Chamber hints, point costs, learning goals,
 * Cheshire Cat extra hint, and educational success feedback.
 */

const WonderEasyHints = {
  openingDialogue: "You say the Queen forbids you? How terribly impolite of her! But tell me, Alice… who checks the claim when the browser makes it?",
  hints: [
    {
      id: "easy-hint-1",
      number: 1,
      title: "The First Page",
      cost: 0,
      text: "Stay inside the Easy Chamber. Its page loads a small helper the Queen forgot to guard. Inspect the page source and find the script she trusts.",
      learningGoal: "Encourage players to inspect the Easy Chamber page."
    },
    {
      id: "easy-hint-2",
      number: 2,
      title: "Open the Looking Glass",
      cost: 100,
      text: "Open the browser's Developer Tools and inspect the scripts loaded by the Easy Chamber. Find where the queen checks if we solved the puzzle or not",
      learningGoal: "Encourage players to inspect the page's JavaScript."
    },
    {
      id: "easy-hint-3",
      number: 3,
      title: "No Arguments Needed",
      cost: 100,
      text: "have you ever tried the web console? I heard it's pretty fun! ;)",
      learningGoal: "Help players understand the helper's signature and the trust boundary."
    },
    {
      id: "easy-hint-4",
      number: 4,
      title: "A Rule Written in Sand",
      cost: 100,
      text: "The queen trusts her functions, sometimes she doesn't even use arguments!",
      learningGoal: "Help players identify the client-side trust flaw and its chamber scope."
    },
    {
      id: "easy-hint-5",
      number: 5,
      title: "The Final Trial",
      cost: 100,
      text: "Use the cat to decipher anything you can't understand!",
      learningGoal: "Guide players toward invoking isSolved() in Easy."
    }
  ],
  cheshireHint: {
    title: "Cheshire Cat — Free Extra Hint",
    cost: 100,
    text: "Easy trusts the browser; Medium and Hard do not. Buy every hint, then bring 200 Sovereigns for my Cipher Lab key."
  },
  successMessage: "The flag was returned because the backend trusted a boolean supplied by the browser. Client-side claims are never proof."
};

if (typeof window !== 'undefined') {
  window.WonderEasyHints = WonderEasyHints;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WonderEasyHints;
}
