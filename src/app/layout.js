import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import StripeReturnBanner from "@/components/StripeReturnBanner";

// The real, licensed Newcastle headline font — replaces the old
// "Lilita One" placeholder.
const headline = localFont({
  src: "../fonts/newcastle/Newcastle-Basic-Clean.otf",
  variable: "--font-headline-local",
  display: "swap",
});

// Otis's own handwriting, used as the customer-facing body font. Admin
// pages (/admin, /admin/orders, /sell) deliberately override back to
// Lora — see those pages for the local override.
const handwriting = localFont({
  src: "../fonts/handwriting/OtisbitmeyersHandwriting-Regular.ttf",
  variable: "--font-handwriting-local",
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
      className={`${headline.variable} ${handwriting.variable} h-full antialiased`}
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
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
