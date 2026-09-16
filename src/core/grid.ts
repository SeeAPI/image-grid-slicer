import type { GuideGeometry, UniformGeometry } from "./types"

export const DEFAULT_MAX_GRID_SIZE = 12
export const DEFAULT_MIN_GUIDE_GAP = 0.01

export const clampGridSize = (value: number, maximum = DEFAULT_MAX_GRID_SIZE) =>
  Math.min(maximum, Math.max(1, Math.floor(value) || 1))

export const createUniformGuides = (count: number) => {
  const safeCount = clampGridSize(count, Number.MAX_SAFE_INTEGER)
  return Array.from({ length: Math.max(0, safeCount - 1) }, (_, index) => (index + 1) / safeCount)
}

export const normalizeGuides = (guides: number[]) =>
  [...guides]
    .filter((guide) => Number.isFinite(guide) && guide > 0 && guide < 1)
    .sort((left, right) => left - right)

export const validateGuides = (guides: number[], minimumGap = DEFAULT_MIN_GUIDE_GAP) => {
  if (!Array.isArray(guides) || !Number.isFinite(minimumGap) || minimumGap < 0) return false
  const boundaries = [0, ...guides, 1]

  return boundaries.every(
    (boundary, index) =>
      Number.isFinite(boundary) &&
      boundary >= 0 &&
      boundary <= 1 &&
      (index === 0 || boundary - boundaries[index - 1] >= minimumGap)
  )
}

export const createUniformGeometry = (rows: number, columns: number): UniformGeometry => ({
  mode: "uniform",
  rows: clampGridSize(rows, Number.MAX_SAFE_INTEGER),
  columns: clampGridSize(columns, Number.MAX_SAFE_INTEGER),
})

export const createGuideGeometry = (rows: number, columns: number): GuideGeometry => ({
  mode: "guides",
  verticalGuides: createUniformGuides(columns),
  horizontalGuides: createUniformGuides(rows),
})
