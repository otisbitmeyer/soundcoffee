import { Suspense } from "react";
import Header from "@/components/Header";
import ShopGrid from "@/components/ShopGrid";
import Footer from "@/components/Footer";

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

      <Footer />
    </>
  );
}
