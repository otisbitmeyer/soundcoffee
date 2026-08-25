"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { SOUND_COFFEE_PUBKEY } from "@/lib/identities";
import LoginModal from "./LoginModal";

function shortNpub(npub) {
  if (!npub) return "";
  return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
}

export default function Header() {
  const { isLoggedIn, pubkey, npub, logout, restoring } = useAuth();
  const { profile } = useProfile(pubkey);
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const displayName = profile?.display_name || profile?.name || shortNpub(npub);
  const isSoundCoffeeAccount = pubkey === SOUND_COFFEE_PUBKEY;

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-50 border-b-4 border-ink bg-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center">
            <Image
              src="/header-logo.png"
              alt="Sound Coffee"
              width={1137}
              height={384}
              className="h-10 w-auto sm:h-12"
              priority
            />
          </Link>

          <nav className="hidden items-center gap-8 font-display text-sm tracking-widest text-ink sm:flex">
            <Link href="/#shop" className="hover:text-rust">SHOP</Link>
            <Link href="/listening-lair" className="hover:text-rust">LISTEN</Link>
            <Link href="/#club" className="hover:text-rust">THE CLUB</Link>
          </nav>

          {restoring ? (
            <div className="h-9 w-24" />
          ) : isLoggedIn ? (
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 border-2 border-ink px-3 py-2 font-display text-sm tracking-widest text-ink transition hover:border-jade hover:text-jade"
              >
                {profile?.picture ? (
                  <img
                    src={profile.picture}
                    alt=""
                    className="h-6 w-6 rounded-full border border-ink object-cover"
                  />
                ) : null}
                {displayName}
                <span className="text-xs">{menuOpen ? "▲" : "▼"}</span>
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-48 border-2 border-ink bg-paper font-display text-sm tracking-widest shadow-lg">
                  <Link
                    href="/dashboard"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-3 text-ink hover:bg-ink hover:text-paper"
                  >
                    DASHBOARD
                  </Link>
                  {isSoundCoffeeAccount && (
                    <>
                      <Link
                        href="/sell"
                        onClick={() => setMenuOpen(false)}
                        className="block border-t border-ink/10 px-4 py-3 text-ink hover:bg-ink hover:text-paper"
                      >
                        NEW LISTING
                      </Link>
                      <Link
                        href="/admin"
                        onClick={() => setMenuOpen(false)}
                        className="block border-t border-ink/10 px-4 py-3 text-ink hover:bg-ink hover:text-paper"
                      >
                        CLUB ADMIN
                      </Link>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                    }}
                    className="block w-full border-t border-ink/10 px-4 py-3 text-left text-rust hover:bg-rust hover:text-paper"
                  >
                    LOG OUT
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setModalOpen(true)}
              className="border-2 border-ink bg-ink px-4 py-2 font-display text-sm tracking-widest text-paper transition hover:bg-rust hover:border-rust"
            >
              LOG IN
            </button>
          )}
        </div>
      </header>

      {modalOpen && <LoginModal onClose={() => setModalOpen(false)} />}
    </>
  );
}
