// Shared formatting for "show both sats and dollars" — the direction
// we're heading for prices sitewide, starting with shipping cost.
// Joined with "//" rather than a plain separator or the word "or" —
// still signals one currency or the other, without reading awkwardly
// in a sentence.
export function formatDualPrice({ sats, usdCents }) {
  const parts = [];
  if (sats != null) parts.push(`${sats.toLocaleString()} sats`);
  if (usdCents != null) parts.push(`$${(usdCents / 100).toFixed(2)}`);
  if (parts.length === 0) return null;
  return parts.join(" // ");
}
