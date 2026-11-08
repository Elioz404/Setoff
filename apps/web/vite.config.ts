import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The page is static: it reads the clearing house straight from a public
// NEAR RPC endpoint, so it can be served from any static host.
export default defineConfig({
  base: process.env.SETOFF_BASE_PATH ?? "/",
  plugins: [react()],
  server: { fs: { allow: ["../.."] } },
});
