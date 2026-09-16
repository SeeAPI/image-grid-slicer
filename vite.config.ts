import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  base: "/image-grid-slicer/",
  plugins: [react()],
  build: {
    outDir: "site-dist",
    emptyOutDir: true,
  },
})
