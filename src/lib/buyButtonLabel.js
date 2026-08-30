// Derives a short, product-specific buy-button label from a listing's
// title, so "BUY BEANS" doesn't show up on a t-shirt. Keyword-based, not
// perfect for every possible product, but covers what a coffee brand
// actually sells — falls back to something generic for anything else.
//
// Order matters here, deliberately: specific merch categories are
// checked FIRST, coffee/beans LAST. The brand name is literally "Sound
// COFFEE" — if the coffee pattern were checked first, it would match
// every single listing title regardless of what the product actually
// is, since the brand name itself contains the word. Keeping "coffee"
// itself in the pattern (not just beans/roast/etc) matters too — the
// actual coffee product's own title is literally just "SOUND COFFEE"
// with no other coffee-specific word in it, so it still needs to match
// something. Positioning it last, after every merch check, is what
// makes both cases work correctly at once.
const KEYWORD_LABELS = [
  [/\b(t-?shirt|tee)\b/i, "BUY SHIRT"],
  [/\b(hoodie|sweatshirt)\b/i, "BUY HOODIE"],
  [/\b(mug|cup)\b/i, "BUY MUG"],
  [/\b(hat|cap|beanie)\b/i, "BUY HAT"],
  [/\b(sticker)\b/i, "BUY STICKERS"],
  [/\b(tote|bag)\b/i, "BUY TOTE"],
  [/\b(vinyl|record|album)\b/i, "BUY VINYL"],
  [/\b(coffee|beans?|roast|blend|yirgacheffe|espresso|decaf)\b/i, "BUY BEANS"],
];

export function buyButtonLabel(title) {
  if (!title) return "BUY NOW";
  for (const [pattern, label] of KEYWORD_LABELS) {
    if (pattern.test(title)) return label;
  }
  return "BUY NOW";
}
