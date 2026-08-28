// V4V 2.0 — a boostagram protocol (not yet a formal NIP) that lets a
// Lightning payment from ANY wallet carry rich metadata (sender,
// amount, message), by publishing a Nostr sidecar event keyed to the
// invoice's own payment_hash. Complementary to NIP-57 zaps, not a
// replacement — this is what lets boosts from wallets that can't do
// keysend or NIP-57 (Strike, Cash App, Wallet of Satoshi, etc.) still
// carry a message and get counted. See: github.com/ReedBTC/localbitcoiners

import { decode as decodeBolt11 } from "light-bolt11-decoder";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";

export const V4V_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://purplepag.es",
];

const APP_NAME = "Sound Coffee";
const APP_VERSION = "1.0";

let v4vPool;
function getPool() {
  if (!v4vPool) v4vPool = new SimplePool();
  return v4vPool;
}

export function extractPaymentHash(bolt11) {
  const decoded = decodeBolt11(bolt11);
  const section = decoded.sections.find((s) => s.name === "payment_hash");
  if (!section?.value || !/^[0-9a-f]{64}$/.test(section.value)) {
    throw new Error("Couldn't extract a valid payment_hash from this invoice.");
  }
  return section.value;
}

/**
 * Publishes a kind 30078 V4V 2.0 boostagram sidecar for an invoice
 * about to be paid. Best-effort by design — per spec, implementations
 * MUST abort rather than publish with a placeholder if payment_hash
 * extraction fails, which this does by simply not publishing (the
 * Lightning payment itself is never blocked on this).
 *
 * identity: either a real signer ({ pubkey, signEvent }) for attributed
 * boosts, or null for anonymous — in which case a fresh burner keypair
 * is generated, used only for this one signature, and never reused.
 */
export async function publishBoostagram({
  bolt11,
  recipientLud16,
  amountMsats,
  message,
  siteUrl,
  identity, // { pubkey, signEvent } | null
}) {
  let paymentHash;
  try {
    paymentHash = extractPaymentHash(bolt11);
  } catch {
    return { published: false, reason: "payment_hash extraction failed" };
  }

  const cleanUrl = (() => {
    try {
      const u = new URL(siteUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
      return siteUrl;
    }
  })();

  const tags = [
    ["d", paymentHash],
    ["app", APP_NAME, APP_VERSION],
    ["type", "donation_boostagram"],
    ["sender", identity ? "" : ""], // filled in below
    ["recipient", recipientLud16],
    ["amount", String(amountMsats)],
    ["url", cleanUrl],
  ];

  const template = {
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: message || "",
  };

  let signed;
  if (identity) {
    // Attributed — real key, real npub in the sender tag.
    template.tags = template.tags.map((t) => (t[0] === "sender" ? ["sender", identity.pubkey] : t));
    try {
      signed = await identity.signEvent(template);
    } catch {
      // Spec's recommended graceful fallback: signer rejected/timed out
      // — degrade to anonymous rather than fail the boost or fall back
      // to unverifiable claimed attribution.
      signed = signAnonymously(template);
    }
  } else {
    signed = signAnonymously(template);
  }

  try {
    await Promise.any(getPool().publish(V4V_RELAYS, signed));
    return { published: true, paymentHash };
  } catch {
    return { published: false, reason: "couldn't reach any relay" };
  }
}

function signAnonymously(template) {
  const burnerKey = generateSecretKey();
  const anonTemplate = {
    ...template,
    tags: template.tags.map((t) => (t[0] === "sender" ? ["sender", ""] : t)),
  };
  return finalizeEvent(anonTemplate, burnerKey);
  // burnerKey deliberately not retained anywhere after this — single use.
}
