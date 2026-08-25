"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";

export default function LoginModal({ onClose }) {
  const { loginWithExtension, loginWithBunker, createNewKeys, importKey } = useAuth();
  const [tab, setTab] = useState("extension"); // "extension" | "bunker" | "create" | "import"
  const [error, setError] = useState("");

  // "create" flow state
  const [createdKeys, setCreatedKeys] = useState(null); // { nsec, npub }
  const [confirmedSaved, setConfirmedSaved] = useState(false);

  // "import" flow state
  const [importValue, setImportValue] = useState("");

  // "bunker" flow state
  const [bunkerInput, setBunkerInput] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function handleExtension() {
    setError("");
    try {
      await loginWithExtension();
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleBunker() {
    setError("");
    setConnecting(true);
    try {
      await loginWithBunker(bunkerInput);
      onClose();
    } catch (e) {
      setError(e.message || "Couldn't connect to that signer.");
    } finally {
      setConnecting(false);
    }
  }

  function handleCreate() {
    setError("");
    const keys = createNewKeys();
    setCreatedKeys({ nsec: keys.nsec, npub: keys.npub });
  }

  function handleImport() {
    setError("");
    try {
      importKey(importValue);
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/80 px-4">
      <div className="w-full max-w-md border-2 border-ink bg-paper">
        <div className="flex items-center justify-between border-b-2 border-ink px-6 py-4">
          <h2 className="font-display text-xl tracking-wide text-ink">
            LOG IN WITH NOSTR
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="font-display text-2xl leading-none text-ink hover:text-rust"
          >
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b-2 border-ink font-display text-[10px] tracking-widest sm:text-xs">
          {[
            ["extension", "EXTENSION"],
            ["bunker", "PHONE"],
            ["create", "CREATE NEW"],
            ["import", "IMPORT KEY"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setError("");
              }}
              className={`flex-1 border-r-2 border-ink px-2 py-3 last:border-r-0 ${
                tab === key
                  ? "bg-ink text-paper"
                  : "text-ink/60 hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="px-6 py-6">
          {error && (
            <p className="mb-4 border-2 border-rust bg-rust/10 px-3 py-2 font-serif text-sm text-rust">
              {error}
            </p>
          )}

          {/* --- EXTENSION --- */}
          {tab === "extension" && (
            <div className="space-y-4 font-serif text-sm text-ink/80">
              <p>
                If you have a Nostr browser extension installed (like Alby or
                nos2x), this is the safest and easiest way to log in &mdash;
                your private key never leaves the extension.
              </p>
              <button
                onClick={handleExtension}
                className="w-full border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper hover:bg-rust hover:border-rust"
              >
                CONNECT EXTENSION
              </button>
            </div>
          )}

          {/* --- BUNKER (mobile / Amber / remote signer) --- */}
          {tab === "bunker" && (
            <div className="space-y-4 font-serif text-sm text-ink/80">
              <p>
                On a phone? Use a remote signer app like{" "}
                <strong>Amber</strong> (Android). Open Amber, copy the
                connection string it gives you (starts with{" "}
                <code className="text-xs">bunker://</code>), and paste it
                below. Your private key stays on your phone the whole time
                &mdash; this site never sees it.
              </p>
              <textarea
                value={bunkerInput}
                onChange={(e) => setBunkerInput(e.target.value)}
                placeholder="bunker://..."
                className="w-full resize-none border-2 border-ink bg-white p-2 font-mono text-xs text-ink"
                rows={3}
              />
              <button
                onClick={handleBunker}
                disabled={!bunkerInput.trim() || connecting}
                className="w-full border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper hover:bg-rust hover:border-rust disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ink disabled:hover:border-ink"
              >
                {connecting ? "CONNECTING…" : "CONNECT"}
              </button>
              {connecting && (
                <p className="text-xs italic text-ink/50">
                  Check your phone &mdash; Amber may be waiting for you to
                  approve the connection.
                </p>
              )}
            </div>
          )}

          {/* --- CREATE NEW --- */}
          {tab === "create" && (
            <div className="space-y-4 font-serif text-sm text-ink/80">
              {!createdKeys ? (
                <>
                  <p>
                    This generates a brand-new Nostr identity right in your
                    browser. Nothing is sent anywhere, and nothing is saved
                    automatically &mdash; you&rsquo;ll need to save your key
                    yourself before you close this window.
                  </p>
                  <button
                    onClick={handleCreate}
                    className="w-full border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper hover:bg-rust hover:border-rust"
                  >
                    GENERATE NEW KEYS
                  </button>
                </>
              ) : (
                <>
                  <p className="border-2 border-rust bg-rust/10 px-3 py-2 text-rust">
                    Save this key somewhere safe right now &mdash; a password
                    manager is ideal. If you lose it or close this window
                    without saving it, it&rsquo;s gone for good and cannot be
                    recovered.
                  </p>
                  <div>
                    <label className="block font-display text-xs tracking-widest text-ink/60">
                      YOUR PRIVATE KEY (nsec)
                    </label>
                    <textarea
                      readOnly
                      value={createdKeys.nsec}
                      onFocus={(e) => e.target.select()}
                      className="mt-1 w-full resize-none border-2 border-ink bg-white p-2 font-mono text-xs text-ink"
                      rows={2}
                    />
                  </div>
                  <div>
                    <label className="block font-display text-xs tracking-widest text-ink/60">
                      YOUR PUBLIC KEY (npub)
                    </label>
                    <textarea
                      readOnly
                      value={createdKeys.npub}
                      onFocus={(e) => e.target.select()}
                      className="mt-1 w-full resize-none border-2 border-ink bg-white p-2 font-mono text-xs text-ink"
                      rows={2}
                    />
                  </div>
                  <label className="flex items-start gap-2 text-ink">
                    <input
                      type="checkbox"
                      checked={confirmedSaved}
                      onChange={(e) => setConfirmedSaved(e.target.checked)}
                      className="mt-1"
                    />
                    I&rsquo;ve saved my nsec somewhere safe.
                  </label>
                  <button
                    disabled={!confirmedSaved}
                    onClick={onClose}
                    className="w-full border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper hover:bg-rust hover:border-rust disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ink disabled:hover:border-ink"
                  >
                    CONTINUE
                  </button>
                </>
              )}
            </div>
          )}

          {/* --- IMPORT --- */}
          {tab === "import" && (
            <div className="space-y-4 font-serif text-sm text-ink/80">
              <p>
                Paste your existing private key (nsec) below. This stays in
                your browser&rsquo;s memory only for this session &mdash;
                it&rsquo;s never saved or sent anywhere, and you&rsquo;ll need
                to paste it again next time you visit.
              </p>
              <textarea
                value={importValue}
                onChange={(e) => setImportValue(e.target.value)}
                placeholder="nsec1..."
                className="w-full resize-none border-2 border-ink bg-white p-2 font-mono text-xs text-ink"
                rows={3}
              />
              <button
                onClick={handleImport}
                disabled={!importValue.trim()}
                className="w-full border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper hover:bg-rust hover:border-rust disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ink disabled:hover:border-ink"
              >
                IMPORT & LOG IN
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
