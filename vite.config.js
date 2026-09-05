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
      "/api": {
        target: `http://127.0.0.1:${env.PORT || 8787}`,
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000,
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            if (res && !res.headersSent) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                error: `Local API proxy error: ${err.message || "Failed to communicate with backend server."}`,
                code: "proxy-error",
              }));
            }
          });
        },
      },
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
