import { zip } from "fflate"
import { sanitizeFilename } from "./filenames"
import type { ImageSlice } from "./types"

export const downloadBlob = (blob: Blob, filename: string) => {
  if (typeof document === "undefined") throw new Error("Downloads require a browser DOM.")
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = filename
  anchor.style.display = "none"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
}

export const createSlicesZip = async (slices: ImageSlice[]) => {
  const entries: Record<string, Uint8Array> = {}
  for (const slice of slices) entries[slice.filename] = new Uint8Array(await slice.blob.arrayBuffer())

  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (error, data) => {
      if (error) reject(error)
      else resolve(data)
    })
  })
  return new Blob([archive as BlobPart], { type: "application/zip" })
}

export const downloadSlicesAsZip = async (slices: ImageSlice[], filename = "image-slices") => {
  if (!slices.length) throw new Error("There are no slices to download.")
  const archive = await createSlicesZip(slices)
  downloadBlob(archive, `${sanitizeFilename(filename)}.zip`)
}
