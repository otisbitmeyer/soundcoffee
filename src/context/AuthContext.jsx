"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { nsecEncode, npubEncode, decode } from "nostr-tools/nip19";
import { getConversationKey, encrypt as nip44EncryptRaw } from "nostr-tools/nip44";

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
  const [method, setMethod] = useState(null); // "extension" | "created" | "imported"
  const [restoring, setRestoring] = useState(true);

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
      if (!secretKey) throw new Error("No key available to encrypt with.");
      const conversationKey = getConversationKey(secretKey, recipientPubkey);
      return nip44EncryptRaw(plaintext, conversationKey);
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
        createNewKeys,
        importKey,
        logout,
        signEvent,
        nip44Encrypt,
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
