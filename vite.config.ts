import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    root: "app",
    base: "/app/",
    plugins: [react()],
    build: {
        outDir: "../dist/app",
        emptyOutDir: true,
        sourcemap: false,
    },
    server: {
        port: 5173,
    },
});
