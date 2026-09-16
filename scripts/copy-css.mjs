import { copyFile, mkdir } from "node:fs/promises"

await mkdir("dist", { recursive: true })
await copyFile("src/react/ImageGridSlicer.css", "dist/styles.css")
