import Image from "next/image";
import Header from "@/components/Header";
import PwaInstallButton from "@/components/PwaInstallButton";

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

      {/* ---------- FOOTER ---------- */}
      <footer className="bg-paper">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-12 text-center">
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
