export const dynamic = "force-static";

export default function manifest() {
  return {
    name: "Sound Coffee",
    short_name: "Sound Coffee",
    description: "Coffee, roasted in-house — and the podcast that goes with it.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf6ee",
    theme_color: "#141311",
    icons: [
      { src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/pwa-icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
