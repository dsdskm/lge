import react from "@vitejs/plugin-react";
import fs from "fs";
import { defineConfig } from "vite";

const sslOptions =
  process.env.SSL_KEY_FILE && process.env.SSL_CRT_FILE
    ? {
      key: fs.readFileSync(process.env.SSL_KEY_FILE),
      cert: fs.readFileSync(process.env.SSL_CRT_FILE),
    }
    : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    https: sslOptions,
    strictPort: true,
    proxy: {
      "/api": {
        target: "https://localhost:3978",
        secure: false,
      },
    },
  },
  esbuild: {
    tsconfigRaw: fs.readFileSync("./tsconfig.app.json"),
  },
});
