"use client";

import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { useAuth } from "@/context/AuthContext";

export default function LoginModal({ onClose }) {
  const { loginWithExtension, createNewKeys, importKey, startNostrConnect, awaitNostrConnectApproval } =
    useAuth();
  const [tab, setTab] = useState("extension"); // "extension" | "amber" | "create" | "import"
  const [error, setError] = useState("");

  // "create" flow state
  const [createdKeys, setCreatedKeys] = useState(null); // { nsec, npub }
  const [confirmedSaved, setConfirmedSaved] = useState(false);

  // "import" flow state
  const [importValue, setImportValue] = useState("");

  // "amber" (nostrconnect) flow state
  const [nostrConnectUri, setNostrConnectUri] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [amberStatus, setAmberStatus] = useState("idle"); // idle | waiting | error
  const [authUrl, setAuthUrl] = useState(null);
  const [capturedWarnings, setCapturedWarnings] = useState([]);
  const connectAttemptRef = useRef(0); // lets a stale attempt's result be ignored if the user hit "try again"
  const abortControllerRef = useRef(null); // cancels the PREVIOUS attempt's still-open subscription on retry

  async function handleExtension() {
    setError("");
    try {
      await loginWithExtension();
      onClose();
    } catch (e) {
      setError(e.message);
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

  async function beginAmberConnect() {
    setError("");
    setAmberStatus("waiting");
    const attempt = ++connectAttemptRef.current;

    // Cancel the PREVIOUS attempt's subscription before starting a new
    // one — otherwise retries just pile up as orphaned, still-listening
    // connections.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    const { uri, clientSecretKey } = startNostrConnect("Sound Coffee");
    setNostrConnectUri(uri);
    setAuthUrl(null);
    setCapturedWarnings([]);
    try {
      const qr = await QRCode.toDataURL(uri, { margin: 1, width: 320 });
      if (connectAttemptRef.current === attempt) setQrDataUrl(qr);
    } catch {
      // QR generation failing doesn't block the deep link from working
    }

    // The underlying library uses console.warn() for a couple of
    // silent-failure paths (malformed/undecryptable events it can't
    // process, an auth_url with no handler) that never surface through
    // our own error handling at all. Capturing this directly in the UI
    // instead of asking anyone to go dig through browser dev tools.
    const originalWarn = console.warn;
    console.warn = (...args) => {
      if (connectAttemptRef.current === attempt) {
        setCapturedWarnings((prev) => [...prev, args.map(String).join(" ")]);
      }
      originalWarn(...args);
    };

    try {
      await awaitNostrConnectApproval(clientSecretKey, uri, controller.signal, (url) => {
        if (connectAttemptRef.current === attempt) setAuthUrl(url);
      });
      clearTimeout(timeoutId);
      if (connectAttemptRef.current !== attempt) return; // superseded by a retry
      onClose();
    } catch (e) {
      clearTimeout(timeoutId);
      if (connectAttemptRef.current !== attempt) return;
      setError(
        controller.signal.aborted
          ? "No response within 2 minutes. Make sure you opened the link or scanned the code in Amber and approved the connection."
          : e.message || "Connection failed. Try again."
      );
      setAmberStatus("error");
    } finally {
      console.warn = originalWarn;
    }
  }

  useEffect(() => {
    if (tab === "amber" && amberStatus === "idle") {
      beginAmberConnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

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
            ["amber", "AMBER / PHONE"],
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

          {/* --- AMBER / PHONE (nostrconnect) --- */}
          {tab === "amber" && (
            <div className="space-y-4 text-center font-serif text-sm text-ink/80">
              <p>
                On a phone with <strong>Amber</strong> (Android) installed,
                tap the link below or scan the code with Amber to connect
                &mdash; your private key stays on your phone the whole
                time, this site never sees it.
              </p>

              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="Nostr Connect QR code"
                  className="mx-auto border-2 border-ink"
                />
              )}

              {nostrConnectUri && (
                <a
                  href={nostrConnectUri}
                  className="block w-full break-all border-2 border-ink bg-ink px-4 py-3 font-display text-sm tracking-widest text-paper hover:bg-rust hover:border-rust"
                >
                  OPEN IN AMBER
                </a>
              )}

              {amberStatus === "waiting" && (
                <p className="text-xs italic text-ink/50">
                  Waiting for approval&hellip; this can take up to 2
                  minutes.
                </p>
              )}

              {capturedWarnings.length > 0 && (
                <div className="border-2 border-rust/40 bg-rust/5 p-3 text-left font-mono text-[11px] text-rust">
                  <p className="font-display tracking-widest text-rust/70">
                    SIGNER WARNINGS
                  </p>
                  {capturedWarnings.map((w, i) => (
                    <p key={i} className="mt-1 break-words">
                      {w}
                    </p>
                  ))}
                </div>
              )}

              {authUrl && (
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full border-2 border-jade bg-jade px-4 py-3 font-display text-sm tracking-widest text-paper hover:bg-ink hover:border-ink"
                >
                  ONE MORE STEP — TAP TO AUTHORIZE
                </a>
              )}

              {amberStatus === "error" && (
                <button
                  onClick={beginAmberConnect}
                  className="w-full border-2 border-ink px-4 py-2 font-display text-xs tracking-widest text-ink hover:border-jade hover:text-jade"
                >
                  TRY AGAIN (NEW CODE)
                </button>
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
