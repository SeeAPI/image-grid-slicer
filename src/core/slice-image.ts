import { createSliceFilename } from "./filenames"
import { createUniformGuides, validateGuides } from "./grid"
import { getMeshCellGeometry, validateMeshGrid } from "./mesh"
import type {
  ImageDimensions,
  ImageSlice,
  ImageSourceInput,
  MeshGrid,
  PixelBounds,
  SliceGeometry,
  SliceImageOptions,
} from "./types"

interface LoadedImage extends ImageDimensions {
  image: CanvasImageSource
  release: () => void
}

const createAbortError = () => new DOMException("Image slicing was cancelled.", "AbortError")

const ensureActive = (signal?: AbortSignal) => {
  if (signal?.aborted) throw createAbortError()
}

const isImageBitmapInput = (source: ImageSourceInput): source is ImageBitmap =>
  typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap

const isImageElementInput = (source: ImageSourceInput): source is HTMLImageElement =>
  typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement

const loadHtmlImage = (blob: Blob): Promise<LoadedImage> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()
    image.decoding = "async"
    image.onload = () => {
      resolve({
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(objectUrl),
      })
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error("The image could not be decoded."))
    }
    image.src = objectUrl
  })

const loadImage = async (source: ImageSourceInput): Promise<LoadedImage> => {
  if (isImageBitmapInput(source)) {
    return { image: source, width: source.width, height: source.height, release: () => undefined }
  }
  if (isImageElementInput(source)) {
    if (!source.complete || source.naturalWidth <= 0 || source.naturalHeight <= 0) {
      throw new Error("The HTML image must be fully loaded before slicing.")
    }
    return {
      image: source,
      width: source.naturalWidth,
      height: source.naturalHeight,
      release: () => undefined,
    }
  }
  if (!(source instanceof Blob)) throw new TypeError("Expected a Blob, File, ImageBitmap, or HTMLImageElement.")

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" })
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch {
      // Safari 等环境对 createImageBitmap 的格式支持不一致，失败后使用 HTMLImageElement 解码。
    }
  }
  return loadHtmlImage(source)
}

const canvasToPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob && blob.size > 0 && blob.type === "image/png") resolve(blob)
      else reject(new Error("The browser could not encode a PNG slice."))
    }, "image/png")
  })

const createCanvas = (width: number, height: number) => {
  if (typeof document === "undefined") {
    throw new Error("Image slicing requires a browser DOM or a compatible adapter.")
  }
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  return canvas
}

const resolveLineGeometry = (geometry: SliceGeometry, minimumGap: number) => {
  if (geometry.mode === "uniform") {
    if (!Number.isInteger(geometry.rows) || geometry.rows < 1) throw new Error("Rows must be a positive integer.")
    if (!Number.isInteger(geometry.columns) || geometry.columns < 1) {
      throw new Error("Columns must be a positive integer.")
    }
    return {
      verticalGuides: createUniformGuides(geometry.columns),
      horizontalGuides: createUniformGuides(geometry.rows),
    }
  }
  if (geometry.mode === "guides") {
    if (!validateGuides(geometry.verticalGuides, minimumGap)) throw new Error("Vertical guides are invalid.")
    if (!validateGuides(geometry.horizontalGuides, minimumGap)) throw new Error("Horizontal guides are invalid.")
    return {
      verticalGuides: [...geometry.verticalGuides],
      horizontalGuides: [...geometry.horizontalGuides],
    }
  }
  return null
}

const drawRectangularSlice = async (
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  bounds: PixelBounds
) => {
  const canvas = createCanvas(bounds.width, bounds.height)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("A 2D canvas context is unavailable.")
  context.drawImage(
    image,
    bounds.originX,
    bounds.originY,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height
  )
  return canvasToPng(canvas)
}

const drawMeshSlice = async (
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  mesh: MeshGrid,
  row: number,
  column: number
) => {
  const { polygon, bounds } = getMeshCellGeometry(mesh, row, column, sourceWidth, sourceHeight)
  const canvas = createCanvas(bounds.width, bounds.height)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("A 2D canvas context is unavailable.")

  // 网格模式保留源图像素位置，只将四边形外部裁成透明；这里不会进行透视拉正。
  const pixelPolygon = polygon.map((point) => ({
    x: point.x * sourceWidth - bounds.originX,
    y: point.y * sourceHeight - bounds.originY,
  }))
  context.beginPath()
  context.moveTo(pixelPolygon[0].x, pixelPolygon[0].y)
  pixelPolygon.slice(1).forEach((point) => context.lineTo(point.x, point.y))
  context.closePath()
  context.clip()
  context.drawImage(image, -bounds.originX, -bounds.originY, sourceWidth, sourceHeight)

  return { blob: await canvasToPng(canvas), bounds, polygon }
}

export const getGeometryDimensions = (geometry: SliceGeometry) => {
  if (geometry.mode === "uniform") return { rows: geometry.rows, columns: geometry.columns }
  if (geometry.mode === "guides") {
    return { rows: geometry.horizontalGuides.length + 1, columns: geometry.verticalGuides.length + 1 }
  }
  return { rows: geometry.mesh.length - 1, columns: (geometry.mesh[0]?.length ?? 1) - 1 }
}

export const sliceImage = async (source: ImageSourceInput, options: SliceImageOptions): Promise<ImageSlice[]> => {
  ensureActive(options.signal)
  const loaded = await loadImage(source)
  const filename = options.filename || (source instanceof File ? source.name : "image")
  const minimumGap = options.minGuideGap ?? 0.01
  const slices: ImageSlice[] = []

  try {
    if (loaded.width < 1 || loaded.height < 1) throw new Error("The source image has invalid dimensions.")

    const lineGeometry = resolveLineGeometry(options.geometry, minimumGap)
    if (lineGeometry) {
      const xEdges = [0, ...lineGeometry.verticalGuides, 1].map((ratio) => Math.round(ratio * loaded.width))
      const yEdges = [0, ...lineGeometry.horizontalGuides, 1].map((ratio) => Math.round(ratio * loaded.height))
      if (
        xEdges.some((edge, index) => index > 0 && edge <= xEdges[index - 1]) ||
        yEdges.some((edge, index) => index > 0 && edge <= yEdges[index - 1])
      ) {
        throw new Error("The source image is too small for this grid.")
      }

      const total = (xEdges.length - 1) * (yEdges.length - 1)
      for (let row = 0; row < yEdges.length - 1; row += 1) {
        for (let column = 0; column < xEdges.length - 1; column += 1) {
          ensureActive(options.signal)
          const bounds = {
            originX: xEdges[column],
            originY: yEdges[row],
            width: xEdges[column + 1] - xEdges[column],
            height: yEdges[row + 1] - yEdges[row],
          }
          const slice: ImageSlice = {
            id: `${row}-${column}`,
            row: row + 1,
            column: column + 1,
            width: bounds.width,
            height: bounds.height,
            filename: createSliceFilename(filename, row + 1, column + 1),
            blob: await drawRectangularSlice(loaded.image, loaded.width, loaded.height, bounds),
            bounds,
          }
          slices.push(slice)
          await options.onProgress?.({ completed: slices.length, total, slice })
        }
      }
      return slices
    }

    const { rows, columns } = getGeometryDimensions(options.geometry)
    if (options.geometry.mode !== "mesh" || rows < 1 || columns < 1) throw new Error("The mesh is empty.")
    if (
      !validateMeshGrid(options.geometry.mesh, rows, columns, {
        sourceWidth: loaded.width,
        sourceHeight: loaded.height,
        minEdgePixels: options.minMeshEdgePixels,
        minCellAreaPixels: options.minMeshCellAreaPixels,
      })
    ) {
      throw new Error("The mesh contains an invalid or collapsed cell.")
    }

    const total = rows * columns
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        ensureActive(options.signal)
        const rendered = await drawMeshSlice(
          loaded.image,
          loaded.width,
          loaded.height,
          options.geometry.mesh,
          row,
          column
        )
        const slice: ImageSlice = {
          id: `${row}-${column}`,
          row: row + 1,
          column: column + 1,
          width: rendered.bounds.width,
          height: rendered.bounds.height,
          filename: createSliceFilename(filename, row + 1, column + 1),
          blob: rendered.blob,
          bounds: rendered.bounds,
          polygon: rendered.polygon,
        }
        slices.push(slice)
        await options.onProgress?.({ completed: slices.length, total, slice })
      }
    }
    return slices
  } finally {
    loaded.release()
  }
}
