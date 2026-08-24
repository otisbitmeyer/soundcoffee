# Swapping in the real "Newcastle" headline font

Right now the site loads a free font called "Lilita One" directly from
Google Fonts, as a stand-in for Newcastle, just so the site has a working
bold headline font today. Here's how to put the real one in once you have
the font files (usually `.woff2` files) from wherever you licensed
Newcastle.

## Steps

1. Create a folder: `src/fonts/newcastle/`
2. Copy your Newcastle `.woff2` file(s) into that folder. If you only have
   one weight, that's fine.
3. Open `src/app/layout.js` and replace this:

   ```js
   import "./globals.css";
   ```

   with:

   ```js
   import localFont from "next/font/local";
   import "./globals.css";

   const headline = localFont({
     src: "../fonts/newcastle/YOUR-FILE-NAME.woff2",
     variable: "--font-headline-local",
     display: "swap",
   });
   ```

4. In that same file, find the `<html lang="en" className="h-full antialiased">`
   line and change it to:

   ```js
   <html lang="en" className={`${headline.variable} h-full antialiased`}>
   ```

5. You can also remove the "Lilita+One" part from the Google Fonts `<link>`
   a few lines down, since you won't need it anymore (leave "Lora" in — that
   one stays as the body font).
6. Open `src/app/globals.css` and change this line:

   ```css
   --font-headline: "Lilita One", sans-serif;
   ```

   to:

   ```css
   --font-headline: var(--font-headline-local), sans-serif;
   ```

7. Save everything, stop the dev server (Ctrl+C in the terminal) and run
   the start command again. The headline text across the site should now be
   in real Newcastle.

If any of this trips you up, paste the exact error message back to Claude
and it'll walk you through the fix.

