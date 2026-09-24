import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  server: {
    host: true,
    https: process.env.NO_SSL ? undefined : {},
  },
  plugins: [
    ...(process.env.NO_SSL ? [] : [basicSsl()]),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        id: "/",
        name: "Toy Snake",
        short_name: "Toy Snake",
        description: "Multiplayer toy snake & apples with local Wi-Fi multiplayer",
        theme_color: "#0f1a13",
        background_color: "#0f1a13",
        display: "fullscreen",
        display_override: ["fullscreen", "standalone"],
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
});
