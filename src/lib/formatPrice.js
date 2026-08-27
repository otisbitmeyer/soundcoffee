// Shared formatting for "show both sats and dollars" — the direction
// we're heading for prices sitewide, starting with shipping cost.
export function formatDualPrice({ sats, usdCents }) {
  const parts = [];
  if (sats != null) parts.push(`${sats.toLocaleString()} sats`);
  if (usdCents != null) parts.push(`$${(usdCents / 100).toFixed(2)}`);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}
