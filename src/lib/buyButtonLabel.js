// Derives a short, product-specific buy-button label from a listing's
// title, so "BUY BEANS" doesn't show up on a t-shirt. Keyword-based, not
// perfect for every possible product, but covers what a coffee brand
// actually sells — falls back to something generic for anything else.
const KEYWORD_LABELS = [
  [/\b(coffee|beans?|roast|blend|yirgacheffe|espresso|decaf)\b/i, "BUY BEANS"],
  [/\b(t-?shirt|tee)\b/i, "BUY SHIRT"],
  [/\b(hoodie|sweatshirt)\b/i, "BUY HOODIE"],
  [/\b(mug|cup)\b/i, "BUY MUG"],
  [/\b(hat|cap|beanie)\b/i, "BUY HAT"],
  [/\b(sticker)\b/i, "BUY STICKERS"],
  [/\b(tote|bag)\b/i, "BUY TOTE"],
  [/\b(vinyl|record|album)\b/i, "BUY VINYL"],
];

export function buyButtonLabel(title) {
  if (!title) return "BUY NOW";
  for (const [pattern, label] of KEYWORD_LABELS) {
    if (pattern.test(title)) return label;
  }
  return "BUY NOW";
}
