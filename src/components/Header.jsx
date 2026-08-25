"use client";

import { useState } from "react";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import LoginModal from "./LoginModal";

function shortNpub(npub) {
  if (!npub) return "";
  return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
}

export default function Header() {
  const { isLoggedIn, npub, logout } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 border-b-4 border-ink bg-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <a href="/" className="flex items-center">
            <Image
              src="/header-logo.png"
              alt="Sound Coffee"
              width={1137}
              height={384}
              className="h-10 w-auto sm:h-12"
              priority
            />
          </a>

          <nav className="hidden items-center gap-8 font-display text-sm tracking-widest text-ink sm:flex">
            <a href="#shop" className="hover:text-rust">SHOP</a>
            <a href="#listen" className="hover:text-rust">LISTEN</a>
            <a href="#club" className="hover:text-rust">THE CLUB</a>
          </nav>

          {isLoggedIn ? (
            <button
              onClick={logout}
              title="Click to log out"
              className="border-2 border-ink px-4 py-2 font-display text-sm tracking-widest text-ink transition hover:border-rust hover:text-rust"
            >
              {shortNpub(npub)}
            </button>
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
