import { Suspense } from "react";
import Image from "next/image";
import Header from "@/components/Header";
import ShopGrid from "@/components/ShopGrid";
import PwaInstallButton from "@/components/PwaInstallButton";

export default function Shop() {
  return (
    <>
      <Header />

      <main className="flex-1 bg-paper">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h1 className="font-display text-4xl tracking-wide text-ink sm:text-5xl">
            SHOP
          </h1>

          <Suspense fallback={null}>
            <ShopGrid />
          </Suspense>
        </div>
      </main>

      <footer className="bg-paper">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 border-t-2 border-ink/10 px-6 py-12 text-center">
          <Image
            src="/logo-mark.png"
            alt="Sound Coffee"
            width={40}
            height={41}
            className="h-10 w-auto"
          />
          <p className="font-display text-xs tracking-widest text-ink/50">
            SOUND COFFEE &mdash; BUILT ON NOSTR
          </p>
          <PwaInstallButton />
        </div>
      </footer>
    </>
  );
}
