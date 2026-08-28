// WebLN — the standard browser extensions like Alby implement for
// paying Lightning invoices directly from a webpage, no separate app or
// QR code needed. Different protocol from Nostr's NIP-07 (that's for
// signing events), though the same popular extensions often support
// both.

export function isWeblnAvailable() {
  return typeof window !== "undefined" && !!window.webln;
}

/** Resolves with { preimage } on success, throws on failure/rejection. */
export async function payInvoiceViaWebln(invoice) {
  if (!isWeblnAvailable()) {
    throw new Error("No browser wallet extension detected.");
  }
  await window.webln.enable();
  return window.webln.sendPayment(invoice);
}
