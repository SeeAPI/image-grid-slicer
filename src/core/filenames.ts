export const sanitizeFilename = (filename = "image") => {
  const withoutExtension = filename.replace(/\.[^.]+$/, "")
  const normalized = withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)

  return normalized || "image"
}

export const createSliceFilename = (filename: string, row: number, column: number) =>
  `${sanitizeFilename(filename)}-r${row}-c${column}.png`
