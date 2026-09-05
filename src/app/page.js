import Image from "next/image";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Header />

      <main className="flex-1">
        {/* ---------- HERO / WELCOME ---------- */}
        <section className="flex min-h-[90vh] items-center bg-ink text-paper">
          <div className="mx-auto max-w-2xl px-6 py-16 text-center">
            <Image
              src="/hero-greeting.png"
              alt="Greetings, friend. I'm glad you're here. Pull up a chair. The coffee is fresh. The conversation is evolving. If you like what you taste (or hear), join us. SOUND COFFEE is still being built. Let's make some magic."
              width={1899}
              height={828}
              className="mx-auto w-full max-w-xl"
              priority
            />

            <Image
              src="/signature.png"
              alt="Otis Bitmeyer"
              width={1774}
              height={887}
              className="mx-auto mt-6 h-auto w-32 sm:w-40"
            />

            <div className="mt-10">
              <a
                href="/shop"
                className="inline-block border-2 border-paper px-6 py-3 font-display text-sm tracking-widest text-paper transition hover:border-jade hover:text-jade"
              >
                BUY THE COFFEE
              </a>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
