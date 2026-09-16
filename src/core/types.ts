export type SliceMode = "uniform" | "guides" | "mesh"

export interface MeshPoint {
  x: number
  y: number
}

export type MeshGrid = MeshPoint[][]

export interface PixelBounds {
  originX: number
  originY: number
  width: number
  height: number
}

export interface MeshValidationOptions {
  sourceWidth: number
  sourceHeight: number
  minEdgePixels?: number
  minCellAreaPixels?: number
}

export interface UniformGeometry {
  mode: "uniform"
  rows: number
  columns: number
}

export interface GuideGeometry {
  mode: "guides"
  verticalGuides: number[]
  horizontalGuides: number[]
}

export interface MeshGeometry {
  mode: "mesh"
  mesh: MeshGrid
}

export type SliceGeometry = UniformGeometry | GuideGeometry | MeshGeometry

export type ImageSourceInput = Blob | ImageBitmap | HTMLImageElement

export interface ImageSlice {
  id: string
  row: number
  column: number
  width: number
  height: number
  filename: string
  blob: Blob
  bounds: PixelBounds
  polygon?: [MeshPoint, MeshPoint, MeshPoint, MeshPoint]
}

export interface SliceProgress {
  completed: number
  total: number
  slice: ImageSlice
}

export interface SliceImageOptions {
  geometry: SliceGeometry
  filename?: string
  signal?: AbortSignal
  minGuideGap?: number
  minMeshEdgePixels?: number
  minMeshCellAreaPixels?: number
  onProgress?: (progress: SliceProgress) => void | Promise<void>
}

export interface ImageDimensions {
  width: number
  height: number
}
