import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (mode === "production" && env.VITE_SQL_BACKEND !== "true") {
    throw new Error("Production builds require VITE_SQL_BACKEND=true.");
  }

  return {
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-router-dom",
      "@tanstack/react-query",
      "lucide-react",
      "clsx",
      "tailwind-merge",
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          framework: ["react", "react-dom", "react-router-dom", "@tanstack/react-query"],
          charts: ["recharts"],
          markdown: ["react-markdown", "remark-gfm"],
          "pdf-export": ["jspdf", "html2canvas"],
          "docx-export": ["jszip"],
        },
      },
    },
  },
  };
});
