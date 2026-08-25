"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { nsecEncode, npubEncode, decode } from "nostr-tools/nip19";

const AuthContext = createContext(null);

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

  return (
    <AuthContext.Provider
      value={{
        pubkey,
        npub,
        secretKey,
        method,
        isLoggedIn: !!pubkey,
        loginWithExtension,
        createNewKeys,
        importKey,
        logout,
        signEvent,
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
