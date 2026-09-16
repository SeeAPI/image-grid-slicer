import { createUniformGuides } from "./grid"
import type { MeshGrid, MeshPoint, MeshValidationOptions, PixelBounds } from "./types"

const BOUNDARY_EPSILON = 1e-9

const isFiniteRatio = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1

const almostEqual = (left: number, right: number) => Math.abs(left - right) <= BOUNDARY_EPSILON

const crossProduct = (a: MeshPoint, b: MeshPoint, c: MeshPoint) =>
  (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)

const distance = (a: MeshPoint, b: MeshPoint) => Math.hypot(b.x - a.x, b.y - a.y)

const toPixelPoint = (point: MeshPoint, sourceWidth: number, sourceHeight: number): MeshPoint => ({
  x: point.x * sourceWidth,
  y: point.y * sourceHeight,
})

const withMeshDefaults = (options: MeshValidationOptions) => ({
  ...options,
  minEdgePixels: options.minEdgePixels ?? 2,
  minCellAreaPixels: options.minCellAreaPixels ?? 4,
})

export const createMeshGrid = (
  rows: number,
  columns: number,
  verticalGuides = createUniformGuides(columns),
  horizontalGuides = createUniformGuides(rows)
): MeshGrid => {
  const xPoints = [0, ...verticalGuides, 1]
  const yPoints = [0, ...horizontalGuides, 1]

  if (xPoints.length !== columns + 1 || yPoints.length !== rows + 1) {
    throw new Error("Guide counts do not match the requested mesh size.")
  }

  return yPoints.map((y) => xPoints.map((x) => ({ x, y })))
}

export const cloneMeshGrid = (mesh: MeshGrid): MeshGrid =>
  mesh.map((row) => row.map((point) => ({ ...point })))

export const getMeshCellPolygon = (
  mesh: MeshGrid,
  row: number,
  column: number
): [MeshPoint, MeshPoint, MeshPoint, MeshPoint] => [
  mesh[row][column],
  mesh[row][column + 1],
  mesh[row + 1][column + 1],
  mesh[row + 1][column],
]

export const getPolygonPixelBounds = (
  polygon: [MeshPoint, MeshPoint, MeshPoint, MeshPoint],
  sourceWidth: number,
  sourceHeight: number
): PixelBounds => {
  const pixelPoints = polygon.map((point) => toPixelPoint(point, sourceWidth, sourceHeight))
  const left = Math.max(0, Math.floor(Math.min(...pixelPoints.map((point) => point.x))))
  const top = Math.max(0, Math.floor(Math.min(...pixelPoints.map((point) => point.y))))
  const right = Math.min(sourceWidth, Math.ceil(Math.max(...pixelPoints.map((point) => point.x))))
  const bottom = Math.min(sourceHeight, Math.ceil(Math.max(...pixelPoints.map((point) => point.y))))

  return {
    originX: left,
    originY: top,
    width: right - left,
    height: bottom - top,
  }
}

export const getMeshCellGeometry = (
  mesh: MeshGrid,
  row: number,
  column: number,
  sourceWidth: number,
  sourceHeight: number
) => {
  const polygon = getMeshCellPolygon(mesh, row, column)
  return {
    polygon,
    bounds: getPolygonPixelBounds(polygon, sourceWidth, sourceHeight),
  }
}

export const isMeshCellValid = (
  mesh: MeshGrid,
  row: number,
  column: number,
  rawOptions: MeshValidationOptions
) => {
  const options = withMeshDefaults(rawOptions)
  const polygon = getMeshCellPolygon(mesh, row, column)
  if (polygon.some((point) => !isFiniteRatio(point.x) || !isFiniteRatio(point.y))) return false

  const pixelPolygon = polygon.map((point) => toPixelPoint(point, options.sourceWidth, options.sourceHeight)) as [
    MeshPoint,
    MeshPoint,
    MeshPoint,
    MeshPoint,
  ]
  const [topLeft, topRight, bottomRight, bottomLeft] = pixelPolygon
  const edges: Array<[MeshPoint, MeshPoint]> = [
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ]
  if (edges.some(([start, end]) => distance(start, end) < options.minEdgePixels)) return false

  // 图像坐标的 Y 轴向下，合法的 TL→TR→BR→BL 四边形必须持续保持正向转折。
  const turns = [
    crossProduct(topLeft, topRight, bottomRight),
    crossProduct(topRight, bottomRight, bottomLeft),
    crossProduct(bottomRight, bottomLeft, topLeft),
    crossProduct(bottomLeft, topLeft, topRight),
  ]
  if (turns.some((turn) => turn <= 0)) return false

  // 四边形沿 TL→BR 拆成两个三角形，分别限制面积以避免极细尖角绕过总面积校验。
  const firstTriangleArea = Math.abs(
    ((topRight.x - topLeft.x) * (bottomRight.y - topLeft.y) -
      (topRight.y - topLeft.y) * (bottomRight.x - topLeft.x)) /
      2
  )
  const secondTriangleArea = Math.abs(
    ((bottomRight.x - topLeft.x) * (bottomLeft.y - topLeft.y) -
      (bottomRight.y - topLeft.y) * (bottomLeft.x - topLeft.x)) /
      2
  )
  if (firstTriangleArea + secondTriangleArea < options.minCellAreaPixels) return false
  if (firstTriangleArea < options.minCellAreaPixels / 4 || secondTriangleArea < options.minCellAreaPixels / 4) {
    return false
  }

  const bounds = getPolygonPixelBounds(polygon, options.sourceWidth, options.sourceHeight)
  return bounds.width > 0 && bounds.height > 0
}

export const validateMeshGrid = (
  mesh: MeshGrid,
  rows: number,
  columns: number,
  options: MeshValidationOptions
) => {
  if (mesh.length !== rows + 1 || mesh.some((row) => row.length !== columns + 1)) return false
  if (mesh.some((row) => row.some((point) => !isFiniteRatio(point.x) || !isFiniteRatio(point.y)))) return false

  for (let column = 0; column <= columns; column += 1) {
    if (!almostEqual(mesh[0][column].y, 0) || !almostEqual(mesh[rows][column].y, 1)) return false
  }
  for (let row = 0; row <= rows; row += 1) {
    if (!almostEqual(mesh[row][0].x, 0) || !almostEqual(mesh[row][columns].x, 1)) return false
  }
  if (
    !almostEqual(mesh[0][0].x, 0) ||
    !almostEqual(mesh[0][0].y, 0) ||
    !almostEqual(mesh[0][columns].x, 1) ||
    !almostEqual(mesh[0][columns].y, 0) ||
    !almostEqual(mesh[rows][0].x, 0) ||
    !almostEqual(mesh[rows][0].y, 1) ||
    !almostEqual(mesh[rows][columns].x, 1) ||
    !almostEqual(mesh[rows][columns].y, 1)
  ) {
    return false
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!isMeshCellValid(mesh, row, column, options)) return false
    }
  }
  return true
}

export const constrainMeshPoint = (
  point: MeshPoint,
  row: number,
  column: number,
  rows: number,
  columns: number
): MeshPoint => {
  const isTopOrBottom = row === 0 || row === rows
  const isLeftOrRight = column === 0 || column === columns
  if (isTopOrBottom && isLeftOrRight) {
    return { x: column === 0 ? 0 : 1, y: row === 0 ? 0 : 1 }
  }

  return {
    x: isLeftOrRight ? (column === 0 ? 0 : 1) : Math.max(0, Math.min(1, point.x)),
    y: isTopOrBottom ? (row === 0 ? 0 : 1) : Math.max(0, Math.min(1, point.y)),
  }
}

export const isMeshPointMoveValid = (
  mesh: MeshGrid,
  row: number,
  column: number,
  candidate: MeshPoint,
  options: MeshValidationOptions
) => {
  const rows = mesh.length - 1
  const columns = (mesh[0]?.length ?? 0) - 1
  if (rows < 1 || columns < 1 || row < 0 || row > rows || column < 0 || column > columns) return false
  if ((row === 0 || row === rows) && (column === 0 || column === columns)) return false

  const nextMesh = mesh.map((meshRow, rowIndex) =>
    rowIndex === row
      ? meshRow.map((point, columnIndex) =>
          columnIndex === column ? constrainMeshPoint(candidate, row, column, rows, columns) : point
        )
      : meshRow
  )

  // 一个交点最多影响四个相邻单元，只检查局部即可在拖动时保持稳定响应。
  for (let cellRow = Math.max(0, row - 1); cellRow <= Math.min(rows - 1, row); cellRow += 1) {
    for (
      let cellColumn = Math.max(0, column - 1);
      cellColumn <= Math.min(columns - 1, column);
      cellColumn += 1
    ) {
      if (!isMeshCellValid(nextMesh, cellRow, cellColumn, options)) return false
    }
  }
  return true
}
