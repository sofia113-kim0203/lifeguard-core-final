import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { lifeguardDevApiPlugin } from "./server/devApiPlugin.js";

export default defineConfig({
  plugins: [react(), lifeguardDevApiPlugin()],
  root: ".",
  publicDir: false,
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: "index.html",
        keyRoomSeat: "key-room-seat.html",
      },
    },
  },
});
