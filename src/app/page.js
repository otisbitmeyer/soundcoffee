import Image from "next/image";
import Header from "@/components/Header";
import PodcastEpisodes from "@/components/PodcastEpisodes";
import ShopGrid from "@/components/ShopGrid";

export default function Home() {
  return (
    <>
      <Header />

      <main className="flex-1">
        {/* ---------- HERO ---------- */}
        <section className="flex min-h-[90vh] items-center border-b-4 border-ink bg-ink text-paper">
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
                href="#club"
                className="inline-block border-2 border-paper px-6 py-3 font-display text-sm tracking-widest text-paper transition hover:border-jade hover:text-jade"
              >
                JOIN THE CLUB
              </a>
            </div>
          </div>
        </section>

        {/* ---------- THE CLUB ---------- */}
        <section id="club" className="border-b-4 border-ink bg-paper">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="font-display text-4xl tracking-wide text-ink sm:text-5xl">
              THE COFFEE CLUB
            </h2>
            <p className="mt-4 max-w-2xl font-serif text-lg text-ink/80">
              Two ways in. Both get you the same membership.
            </p>

            <div className="mt-12 grid gap-8 sm:grid-cols-2">
              <div className="border-2 border-ink p-8">
                <span className="font-display text-sm tracking-widest text-rust">
                  01 &mdash; BUY THE COFFEE
                </span>
                <h3 className="mt-3 font-display text-2xl text-ink">
                  Purchase a bag
                </h3>
                <p className="mt-3 font-serif text-ink/75">
                  Any coffee order gets you into the club. Attach your Nostr
                  npub at checkout and you&rsquo;re in.
                </p>
              </div>

              <div className="border-2 border-ink p-8">
                <span className="font-display text-sm tracking-widest text-jade">
                  02 &mdash; BOOST THE SHOW
                </span>
                <h3 className="mt-3 font-display text-2xl text-ink">
                  Zap the podcast
                </h3>
                <p className="mt-3 font-serif text-ink/75">
                  Send a boost (a Lightning zap) to the show and you&rsquo;re
                  in &mdash; no purchase necessary.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- SHOP ---------- */}
        <section id="shop" className="border-b-4 border-ink bg-paper">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="font-display text-4xl tracking-wide text-ink sm:text-5xl">
              SHOP
            </h2>

            <ShopGrid />
          </div>
        </section>

        {/* ---------- LISTEN ---------- */}
        <section id="listen" className="border-b-4 border-ink bg-ink text-paper">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="font-display text-4xl tracking-wide sm:text-5xl">
              LISTEN
            </h2>
            <p className="mt-4 max-w-2xl font-serif text-lg text-paper/80">
              Conversations in the coffee shop. New edition most months.
            </p>

            <PodcastEpisodes />
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
        </div>
      </footer>
    </>
  );
}
