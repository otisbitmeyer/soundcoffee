"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { nsecEncode, npubEncode, decode } from "nostr-tools/nip19";
import { getConversationKey, encrypt as nip44EncryptRaw, decrypt as nip44DecryptRaw } from "nostr-tools/nip44";
import { decrypt as nip04DecryptRaw } from "nostr-tools/nip04";
import { BunkerSigner, parseBunkerInput } from "nostr-tools/nip46";
import { bytesToHex } from "nostr-tools/utils";
import { DEFAULT_RELAYS } from "@/lib/relays";

const AuthContext = createContext(null);

// Only ever stores { pubkey, method: "extension" } — NEVER a secret key.
// This is what makes persistence safe: an extension session can be
// restored by just asking the extension for its pubkey again (it holds
// the real key, not us). Created/imported keys are deliberately never
// persisted here — see the note by `secretKey` below.
const STORAGE_KEY = "sound-coffee-auth";

export function AuthProvider({ children }) {
  // pubkey: hex public key, always safe to keep in state/memory.
  // secretKey: Uint8Array, ONLY present for "create" / "import" methods.
  //   Deliberately kept in memory only — never written to localStorage —
  //   because persisting a private key in browser storage is a real
  //   security risk (any malicious script or extension on the page could
  //   read it). Extension users don't have this concern since the
  //   extension itself holds their key, not this site.
  const [pubkey, setPubkey] = useState(null);
  const [secretKey, setSecretKey] = useState(null);
  const [method, setMethod] = useState(null); // "extension" | "created" | "imported" | "bunker"
  const [restoring, setRestoring] = useState(true);
  const bunkerSignerRef = useRef(null);

  // On first load, silently try to restore an extension session. Created/
  // imported-key sessions can't be restored this way on purpose — those
  // log out on refresh, which is the intended, safer default for holding
  // an actual private key.
  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved.method === "extension" && window.nostr) {
          const pk = await window.nostr.getPublicKey();
          setPubkey(pk);
          setMethod("extension");
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  const loginWithExtension = useCallback(async () => {
    if (typeof window === "undefined" || !window.nostr) {
      throw new Error(
        "No Nostr extension found. Install one (e.g. Alby or nos2x) and reload the page."
      );
    }
    const pk = await window.nostr.getPublicKey();
    setPubkey(pk);
    setSecretKey(null);
    setMethod("extension");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ method: "extension" }));
    return pk;
  }, []);

  const createNewKeys = useCallback(() => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    setPubkey(pk);
    setSecretKey(sk);
    setMethod("created");
    return { secretKey: sk, pubkey: pk, nsec: nsecEncode(sk), npub: npubEncode(pk) };
  }, []);

  // A fresh, order-scoped identity for guest checkout — real Nostr keys,
  // real order/chat/dashboard functionality, but generated silently with
  // zero setup for someone who doesn't already have a Nostr identity and
  // shouldn't have to get one just to buy coffee. Distinct from
  // createNewKeys (method: "guest" vs "created") so the UI can treat it
  // more gently — this isn't "your account," just this one order's key.
  const createGuestKeys = useCallback(() => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    setPubkey(pk);
    setSecretKey(sk);
    setMethod("guest");
    return { secretKey: sk, pubkey: pk, nsec: nsecEncode(sk), npub: npubEncode(pk) };
  }, []);

  // NIP-46 remote signer login (e.g. Amber on Android). `bunkerInput` is
  // either a "bunker://..." connection string or an nsec.app-style
  // NIP-05 identifier. The actual private key never touches this site —
  // it stays on the signer device the whole time.
  // NIP-46 remote signer login (e.g. Amber on Android). `bunkerInput` is
  // either a "bunker://..." connection string or an nsec.app-style
  // NIP-05 identifier. The actual private key never touches this site —
  // it stays on the signer device the whole time.
  //
  // The underlying library has NO built-in timeout on connect() — if the
  // remote signer never responds (wrong relay, app not open, notification
  // missed, etc.) it just hangs forever with no error at all. We wrap it
  // in our own timeout so a failed connection actually surfaces as an
  // error instead of silently doing nothing.
  const loginWithBunker = useCallback(async (bunkerInput) => {
    const bp = await parseBunkerInput(bunkerInput.trim());
    if (!bp) throw new Error("Couldn't understand that connection string.");
    const clientSecretKey = generateSecretKey();
    const signer = BunkerSigner.fromBunker(clientSecretKey, bp);

    function withTimeout(promise, ms, message) {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
      ]);
    }

    await withTimeout(
      signer.connect(),
      60000,
      "No response from your signer app after 60 seconds. Make sure it's open and check for an approval prompt, then try again."
    );
    const pk = await withTimeout(
      signer.getPublicKey(),
      20000,
      "Connected, but didn't get a response for your public key. Try again."
    );

    bunkerSignerRef.current = signer;
    setPubkey(pk);
    setSecretKey(null);
    setMethod("bunker");
    return pk;
  }, []);

  // nostrconnect:// — the reverse of the bunker:// flow above. Instead of
  // the signer app generating a string for the user to paste here, WE
  // generate a connection request (as a QR code / deep link) and the
  // signer app connects back to us once approved. Generally the more
  // reliable of the two flows with apps like Amber.
  const startNostrConnect = useCallback((appName) => {
    const clientSecretKey = generateSecretKey();
    const clientPubkey = getPublicKey(clientSecretKey);
    // Random token the signer must echo back — this is what proves the
    // eventual response is really answering THIS request, not some
    // unrelated/spoofed one.
    const secret = bytesToHex(generateSecretKey()).slice(0, 32);
    // Multiple relays, not one — a single relay having any hiccup
    // (idle timeout, rate limit, restart) would otherwise kill the
    // whole connection attempt with no fallback. The spec explicitly
    // supports repeating the relay param for this exact reason.
    const relays = DEFAULT_RELAYS.slice(0, 3);

    const params = new URLSearchParams();
    for (const relay of relays) params.append("relay", relay);
    params.set("secret", secret);
    // Declared upfront, all in the one initial approval — without this,
    // the signer likely has to show a SEPARATE prompt for every
    // individual action (get_public_key, then signing, then
    // decrypting), which is easy to miss if you're not expecting a
    // second prompt right after approving the connection itself. This
    // is very likely why get_public_key specifically timed out even
    // though the connection succeeded.
    params.set("perms", "get_public_key,sign_event,nip44_encrypt,nip44_decrypt");
    // Amber's own team documents this as a single JSON-encoded
    // "metadata" param — not separate name/url query params, which is
    // what the more generic NIP-46 spec examples show and what we had
    // built before. Keeping a plain "name" param too, redundantly, in
    // case some other signer expects that convention instead — costs
    // nothing, and doesn't conflict with anything.
    if (appName) {
      params.set("metadata", JSON.stringify({ name: appName }));
      params.set("name", appName);
    }

    const uri = `nostrconnect://${clientPubkey}?${params.toString()}`;
    return { uri, clientSecretKey };
  }, []);

  const awaitNostrConnectApproval = useCallback(async (clientSecretKey, uri, signal) => {
    // skipSwitchRelays: without this, the library automatically tries
    // to switch to a different relay set immediately after connecting
    // — if that switch lands somewhere the signer isn't actually
    // listening, every request AFTER the initial connect (like this
    // one, get_public_key) goes nowhere, while the connect itself
    // (on the original relays) still succeeded. Likely the actual
    // explanation for get_public_key timing out despite a successful
    // connection.
    const signer = await BunkerSigner.fromURI(clientSecretKey, uri, { skipSwitchRelays: true }, signal);

    // Same gap as the bunker:// flow — getPublicKey() has no built-in
    // timeout in the underlying library, so an unresponsive signer here
    // would otherwise hang forever with no error at all. Longer than
    // the bunker:// version's 20s as a safety margin — if declaring
    // perms upfront doesn't fully eliminate a follow-up prompt on some
    // signer, this gives more room to notice and respond to it.
    const pk = await Promise.race([
      signer.getPublicKey(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Connected, but didn't get a response for your public key. Try again.")),
          45000
        )
      ),
    ]);

    bunkerSignerRef.current = signer;
    setPubkey(pk);
    setSecretKey(null);
    setMethod("bunker");
    return pk;
  }, []);

  const importKey = useCallback((nsecOrHex) => {
    const trimmed = nsecOrHex.trim();
    let sk;
    if (trimmed.startsWith("nsec1")) {
      const decoded = decode(trimmed);
      if (decoded.type !== "nsec") {
        throw new Error("That doesn't look like a valid nsec key.");
      }
      sk = decoded.data;
    } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      sk = Uint8Array.from(Buffer.from(trimmed, "hex"));
    } else {
      throw new Error(
        "Enter either an nsec key (starts with nsec1) or a 64-character hex private key."
      );
    }
    const pk = getPublicKey(sk);
    setPubkey(pk);
    setSecretKey(sk);
    setMethod("imported");
    return { secretKey: sk, pubkey: pk, npub: npubEncode(pk) };
  }, []);

  const logout = useCallback(() => {
    if (bunkerSignerRef.current) {
      bunkerSignerRef.current.close?.();
      bunkerSignerRef.current = null;
    }
    setPubkey(null);
    setSecretKey(null);
    setMethod(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // Signs a Nostr event template ({ kind, created_at, tags, content }),
  // regardless of which login method is active. Extension users sign via
  // the extension (their key never touches this site); created/imported
  // users sign with the in-memory secret key.
  const signEvent = useCallback(
    async (template) => {
      if (!pubkey) throw new Error("Not logged in.");
      if (method === "extension") {
        if (!window.nostr) throw new Error("Nostr extension not available.");
        return window.nostr.signEvent(template);
      }
      if (method === "bunker") {
        if (!bunkerSignerRef.current) throw new Error("Remote signer not connected.");
        return bunkerSignerRef.current.signEvent(template);
      }
      if (!secretKey) throw new Error("No key available to sign with.");
      return finalizeEvent(template, secretKey);
    },
    [pubkey, method, secretKey]
  );

  const npub = pubkey ? npubEncode(pubkey) : null;

  // NIP-44 encryption for the sender's own real identity — needed to
  // "seal" a NIP-17 message so only the recipient can read it. Extension
  // users encrypt via the extension (key never leaves it); local-key
  // users encrypt with nostr-tools directly.
  const nip44Encrypt = useCallback(
    async (recipientPubkey, plaintext) => {
      if (!pubkey) throw new Error("Not logged in.");
      if (method === "extension") {
        if (!window.nostr?.nip44?.encrypt) {
          throw new Error(
            "This extension doesn't support encrypted messages (NIP-44) yet. Try creating or importing a key instead."
          );
        }
        return window.nostr.nip44.encrypt(recipientPubkey, plaintext);
      }
      if (method === "bunker") {
        if (!bunkerSignerRef.current) throw new Error("Remote signer not connected.");
        return bunkerSignerRef.current.nip44Encrypt(recipientPubkey, plaintext);
      }
      if (!secretKey) throw new Error("No key available to encrypt with.");
      const conversationKey = getConversationKey(secretKey, recipientPubkey);
      return nip44EncryptRaw(plaintext, conversationKey);
    },
    [pubkey, method, secretKey]
  );

  // The inverse of nip44Encrypt — needed to read incoming encrypted
  // messages (like NIP-17 order DMs), not just send them.
  const nip44Decrypt = useCallback(
    async (senderPubkey, ciphertext) => {
      if (!pubkey) throw new Error("Not logged in.");
      if (method === "extension") {
        if (!window.nostr?.nip44?.decrypt) {
          throw new Error(
            "This extension doesn't support encrypted messages (NIP-44) yet."
          );
        }
        return window.nostr.nip44.decrypt(senderPubkey, ciphertext);
      }
      if (method === "bunker") {
        if (!bunkerSignerRef.current) throw new Error("Remote signer not connected.");
        return bunkerSignerRef.current.nip44Decrypt(senderPubkey, ciphertext);
      }
      if (!secretKey) throw new Error("No key available to decrypt with.");
      const conversationKey = getConversationKey(secretKey, senderPubkey);
      return nip44DecryptRaw(ciphertext, conversationKey);
    },
    [pubkey, method, secretKey]
  );

  // Older encryption standard — some apps (Conduit among them, it turns
  // out) still send DMs this way instead of the newer NIP-17/NIP-44.
  // Only used for reading, never for sending anything new ourselves.
  const nip04Decrypt = useCallback(
    async (senderPubkey, ciphertext) => {
      if (!pubkey) throw new Error("Not logged in.");
      if (method === "extension") {
        if (!window.nostr?.nip04?.decrypt) {
          throw new Error(
            "This extension doesn't support NIP-04 decryption."
          );
        }
        return window.nostr.nip04.decrypt(senderPubkey, ciphertext);
      }
      if (method === "bunker") {
        if (!bunkerSignerRef.current) throw new Error("Remote signer not connected.");
        return bunkerSignerRef.current.nip04Decrypt(senderPubkey, ciphertext);
      }
      if (!secretKey) throw new Error("No key available to decrypt with.");
      return nip04DecryptRaw(secretKey, senderPubkey, ciphertext);
    },
    [pubkey, method, secretKey]
  );

  return (
    <AuthContext.Provider
      value={{
        pubkey,
        npub,
        secretKey,
        method,
        isLoggedIn: !!pubkey,
        restoring,
        loginWithExtension,
        loginWithBunker,
        startNostrConnect,
        awaitNostrConnectApproval,
        createNewKeys,
        createGuestKeys,
        importKey,
        logout,
        signEvent,
        nip44Encrypt,
        nip44Decrypt,
        nip04Decrypt,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
