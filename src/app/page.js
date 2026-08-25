import Image from "next/image";
import Header from "@/components/Header";

export default function Home() {
  return (
    <>
      <Header />

      <main className="flex-1">
        {/* ---------- HERO ---------- */}
        <section className="border-b-4 border-ink bg-ink text-paper">
          <div className="mx-auto max-w-5xl px-6 py-24 sm:py-32">
            <h1 className="font-display text-7xl leading-[0.9] tracking-wide sm:text-9xl">
              SOUND
              <br />
              COFFEE
            </h1>

            <div className="mt-10 max-w-xl space-y-3 font-serif text-lg text-paper/80 sm:text-xl">
              <p>Welcome! We&rsquo;re glad you&rsquo;re here.</p>
              <p>
                The coffee is fresh and we&rsquo;re right in the middle of
                making some cool things.
              </p>
              <p>Wanna join us?</p>
            </div>

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

            <p className="mt-10 max-w-2xl font-serif text-ink/70">
              Club members can list their own goods for other members to
              browse right here on the site &mdash; sourced straight from the
              open Nostr network.
            </p>
          </div>
        </section>

        {/* ---------- SHOP ---------- */}
        <section id="shop" className="border-b-4 border-ink bg-paper">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-4xl tracking-wide text-ink sm:text-5xl">
                SHOP
              </h2>
              <span className="font-serif italic text-ink/50">
                live products load here
              </span>
            </div>

            <div className="mt-12 grid gap-8 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="group border-2 border-ink">
                  <div className="flex aspect-square items-center justify-center border-b-2 border-ink bg-ink/5">
                    <span className="font-display text-xs tracking-widest text-ink/40">
                      PRODUCT IMAGE
                    </span>
                  </div>
                  <div className="p-5">
                    <h3 className="font-display text-lg text-ink">
                      Placeholder Roast
                    </h3>
                    <p className="mt-1 font-serif text-sm text-ink/60">
                      Pulled live from a NIP-99 listing once connected.
                    </p>
                    <span className="mt-3 block font-display text-rust">
                      $18.00
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- LISTEN ---------- */}
        <section id="listen" className="border-b-4 border-ink bg-ink text-paper">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="font-display text-4xl tracking-wide sm:text-5xl">
              LISTEN
            </h2>
            <p className="mt-4 max-w-2xl font-serif text-lg text-paper/80">
              The Sound Coffee podcast &mdash; new episodes soon.
            </p>

            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="flex items-center justify-between border-2 border-paper/30 p-6"
                >
                  <div>
                    <span className="font-display text-sm tracking-widest text-jade">
                      EPISODE {i}
                    </span>
                    <h3 className="mt-2 font-display text-xl">
                      Episode title goes here
                    </h3>
                  </div>
                  <span className="font-display text-sm tracking-widest text-paper/50">
                    PLAY &rarr;
                  </span>
                </div>
              ))}
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
        </div>
      </footer>
    </>
  );
}
