import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import StripeReturnBanner from "@/components/StripeReturnBanner";
import PwaInstall from "@/components/PwaInstall";

// The real, licensed Newcastle headline font — replaces the old
// "Lilita One" placeholder.
const headline = localFont({
  src: "../fonts/newcastle/Newcastle-Basic-Clean.otf",
  variable: "--font-headline-local",
  display: "swap",
});

export const metadata = {
  title: "Sound Coffee",
  description: "Sound Coffee — coffee, podcast, and the club that connects them.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${headline.variable} h-full antialiased`}
    >
      <head>
        {/* Lora (body serif) still loads from Google Fonts.
            Newcastle now loads locally, so no Google request needed for it. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col font-serif">
        <AuthProvider>
          <StripeReturnBanner />
          <PwaInstall />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
