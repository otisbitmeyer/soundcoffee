import Image from "next/image";
import PwaInstallButton from "./PwaInstallButton";

export default function Footer() {
  return (
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
        <a
          href="mailto:orders@soundcoffee.org"
          className="font-display text-sm tracking-widest text-ink transition hover:text-jade"
        >
          SEND AN EMAIL
        </a>
        <a
          href="https://njump.me/npub186pzq2z7xjma6gsjkm4kyeyvfck0lk4t9a6qmtht2pq9axyr73wshad0rk"
          target="_blank"
          rel="noopener noreferrer"
          className="font-display text-sm tracking-widest text-ink transition hover:text-jade"
        >
          CONNECT ON NOSTR
        </a>
        <PwaInstallButton />
      </div>
    </footer>
  );
}
