import {
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  clampGridSize,
  cloneMeshGrid,
  constrainMeshPoint,
  createMeshGrid,
  createUniformGuides,
  downloadBlob,
  downloadSlicesAsZip,
  isMeshPointMoveValid,
  normalizeGuides,
  sliceImage,
  type ImageSlice,
  type MeshGrid,
  type MeshPoint,
  type SliceGeometry,
  type SliceMode,
} from "../core"
import { defaultImageGridSlicerMessages, type ImageGridSlicerMessages } from "./messages"

interface SourceMetadata {
  name: string
  width: number
  height: number
}

interface SlicePreview extends ImageSlice {
  previewUrl: string
}

type GuideOrientation = "vertical" | "horizontal"

interface GuideDrag {
  orientation: GuideOrientation
  index: number
}

interface MeshDrag {
  row: number
  column: number
  pointerId: number
}

export interface ImageGridSlicerProps {
  className?: string
  accentColor?: string
  maxFileBytes?: number
  maxPixels?: number
  maxGridSize?: number
  maxSlices?: number
  messages?: Partial<ImageGridSlicerMessages>
  onSlicesComplete?: (slices: ImageSlice[]) => void | Promise<void>
}

const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_PIXELS = 40_000_000
const DEFAULT_MAX_SLICES = 100
const MIN_GUIDE_GAP = 0.01
const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])
const PRESETS = [
  { label: "2 × 2", rows: 2, columns: 2 },
  { label: "3 × 3", rows: 3, columns: 3 },
  { label: "4 × 4", rows: 4, columns: 4 },
  { label: "4 × 6", rows: 4, columns: 6 },
]

const replaceTokens = (value: string, tokens: Record<string, string | number>) =>
  Object.entries(tokens).reduce((result, [token, replacement]) => result.replace(`%${token}%`, String(replacement)), value)

const readImageDimensions = (url: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error("The image could not be decoded."))
    image.src = url
  })

const getLargestGapMidpoint = (guides: number[]) => {
  const boundaries = [0, ...normalizeGuides(guides), 1]
  let start = 0
  let size = 0
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const currentSize = boundaries[index + 1] - boundaries[index]
    if (currentSize > size) {
      start = boundaries[index]
      size = currentSize
    }
  }
  return size > MIN_GUIDE_GAP * 2 ? start + size / 2 : null
}

const ModeMark = ({ mode }: { mode: SliceMode }) => {
  if (mode === "uniform") return <span className="is-mode-mark is-mode-mark--uniform" aria-hidden="true" />
  if (mode === "guides") return <span className="is-mode-mark is-mode-mark--guides" aria-hidden="true" />
  return <span className="is-mode-mark is-mode-mark--mesh" aria-hidden="true" />
}

const Counter = ({
  id,
  label,
  value,
  maximum,
  disabled,
  decreaseLabel,
  increaseLabel,
  onChange,
}: {
  id: string
  label: string
  value: number
  maximum: number
  disabled: boolean
  decreaseLabel: string
  increaseLabel: string
  onChange: (value: number) => void
}) => (
  <label className="is-counter" htmlFor={id}>
    <span>{label}</span>
    <span className="is-counter__control">
      <button
        type="button"
        aria-label={decreaseLabel}
        disabled={disabled || value <= 1}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <input
        id={id}
        type="number"
        min={1}
        max={maximum}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <button
        type="button"
        aria-label={increaseLabel}
        disabled={disabled || value >= maximum}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </span>
  </label>
)

export function ImageGridSlicer({
  className,
  accentColor = "#6d5dfc",
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  maxPixels = DEFAULT_MAX_PIXELS,
  maxGridSize = 12,
  maxSlices = DEFAULT_MAX_SLICES,
  messages,
  onSlicesComplete,
}: ImageGridSlicerProps) {
  const text = useMemo(() => ({ ...defaultImageGridSlicerMessages, ...messages }), [messages])
  const inputId = useId()
  const rowsId = useId()
  const columnsId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const sourceUrlRef = useRef<string | null>(null)
  const previewsRef = useRef<SlicePreview[]>([])
  const meshRef = useRef<MeshGrid>(createMeshGrid(3, 3))
  const abortRef = useRef<AbortController | null>(null)

  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [sourceMetadata, setSourceMetadata] = useState<SourceMetadata | null>(null)
  const [mode, setMode] = useState<SliceMode>("uniform")
  const [rows, setRows] = useState(3)
  const [columns, setColumns] = useState(3)
  const [verticalGuides, setVerticalGuides] = useState(() => createUniformGuides(3))
  const [horizontalGuides, setHorizontalGuides] = useState(() => createUniformGuides(3))
  const [mesh, setMesh] = useState<MeshGrid>(() => createMeshGrid(3, 3))
  const [guideDrag, setGuideDrag] = useState<GuideDrag | null>(null)
  const [meshDrag, setMeshDrag] = useState<MeshDrag | null>(null)
  const [invalidMeshMove, setInvalidMeshMove] = useState(false)
  const [previews, setPreviews] = useState<SlicePreview[]>([])
  const [isSlicing, setIsSlicing] = useState(false)
  const [isPreparingZip, setIsPreparingZip] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const safeGridMaximum = Math.max(1, Math.floor(maxGridSize))
  const expectedCount = rows * columns
  const gridTooLarge = expectedCount > maxSlices
  const isBusy = isSlicing || isPreparingZip

  const clearPreviews = useCallback(() => {
    previewsRef.current.forEach((preview) => URL.revokeObjectURL(preview.previewUrl))
    previewsRef.current = []
    setPreviews([])
    setNotice(null)
  }, [])

  const setNextMesh = useCallback((nextMesh: MeshGrid) => {
    meshRef.current = nextMesh
    setMesh(nextMesh)
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current)
      previewsRef.current.forEach((preview) => URL.revokeObjectURL(preview.previewUrl))
    }
  }, [])

  const resetGeometry = useCallback(
    (nextRows = 3, nextColumns = 3) => {
      const safeRows = clampGridSize(nextRows, safeGridMaximum)
      const safeColumns = clampGridSize(nextColumns, safeGridMaximum)
      const nextVerticalGuides = createUniformGuides(safeColumns)
      const nextHorizontalGuides = createUniformGuides(safeRows)
      setRows(safeRows)
      setColumns(safeColumns)
      setVerticalGuides(nextVerticalGuides)
      setHorizontalGuides(nextHorizontalGuides)
      setNextMesh(createMeshGrid(safeRows, safeColumns, nextVerticalGuides, nextHorizontalGuides))
      setInvalidMeshMove(false)
      clearPreviews()
    },
    [clearPreviews, safeGridMaximum, setNextMesh]
  )

  const loadFile = useCallback(
    async (file?: File) => {
      if (!file || isBusy) return
      setError(null)
      setNotice(null)
      if (!SUPPORTED_TYPES.has(file.type)) {
        setError(text.unsupportedFile)
        return
      }
      if (file.size <= 0 || file.size > maxFileBytes) {
        setError(replaceTokens(text.fileTooLarge, { size: Math.round(maxFileBytes / (1024 * 1024)) }))
        return
      }

      const pendingUrl = URL.createObjectURL(file)
      try {
        const dimensions = await readImageDimensions(pendingUrl)
        if (dimensions.width * dimensions.height > maxPixels) {
          throw new Error(text.imageTooLarge)
        }
        if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current)
        sourceUrlRef.current = pendingUrl
        setSourceUrl(pendingUrl)
        setSourceFile(file)
        setSourceMetadata({ name: file.name, ...dimensions })
        setMode("uniform")
        resetGeometry()
      } catch (loadError) {
        URL.revokeObjectURL(pendingUrl)
        setError(loadError instanceof Error ? loadError.message : text.unsupportedFile)
      }
    },
    [isBusy, maxFileBytes, maxPixels, resetGeometry, text]
  )

  const resetAll = () => {
    if (isBusy) return
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current)
    sourceUrlRef.current = null
    setSourceUrl(null)
    setSourceFile(null)
    setSourceMetadata(null)
    setMode("uniform")
    resetGeometry()
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const applyGridSize = (axis: "rows" | "columns", value: number) => {
    const nextRows = axis === "rows" ? clampGridSize(value, safeGridMaximum) : rows
    const nextColumns = axis === "columns" ? clampGridSize(value, safeGridMaximum) : columns
    resetGeometry(nextRows, nextColumns)
  }

  const changeMode = (nextMode: SliceMode) => {
    if (isBusy || nextMode === mode) return
    if (nextMode === "guides") {
      setVerticalGuides(createUniformGuides(columns))
      setHorizontalGuides(createUniformGuides(rows))
    }
    if (nextMode === "mesh") {
      const nextMesh = createMeshGrid(rows, columns, verticalGuides, horizontalGuides)
      setNextMesh(nextMesh)
    }
    setMode(nextMode)
    setInvalidMeshMove(false)
    clearPreviews()
  }

  const moveGuide = useCallback(
    (orientation: GuideOrientation, index: number, nextValue: number) => {
      const update = (previous: number[]) =>
        previous.map((guide, guideIndex) => {
          if (guideIndex !== index) return guide
          const before = index > 0 ? previous[index - 1] + MIN_GUIDE_GAP : MIN_GUIDE_GAP
          const after = index < previous.length - 1 ? previous[index + 1] - MIN_GUIDE_GAP : 1 - MIN_GUIDE_GAP
          return Math.max(before, Math.min(after, nextValue))
        })
      if (orientation === "vertical") setVerticalGuides(update)
      else setHorizontalGuides(update)
      clearPreviews()
    },
    [clearPreviews]
  )

  const removeGuide = (orientation: GuideOrientation, index: number) => {
    if (isBusy) return
    if (orientation === "vertical") {
      const nextGuides = verticalGuides.filter((_, guideIndex) => guideIndex !== index)
      setVerticalGuides(nextGuides)
      setColumns(nextGuides.length + 1)
    } else {
      const nextGuides = horizontalGuides.filter((_, guideIndex) => guideIndex !== index)
      setHorizontalGuides(nextGuides)
      setRows(nextGuides.length + 1)
    }
    clearPreviews()
  }

  const addGuide = (orientation: GuideOrientation) => {
    if (isBusy) return
    const current = orientation === "vertical" ? verticalGuides : horizontalGuides
    if (current.length >= safeGridMaximum - 1) return
    const midpoint = getLargestGapMidpoint(current)
    if (midpoint === null) return
    const nextGuides = normalizeGuides([...current, midpoint])
    if (orientation === "vertical") {
      setVerticalGuides(nextGuides)
      setColumns(nextGuides.length + 1)
    } else {
      setHorizontalGuides(nextGuides)
      setRows(nextGuides.length + 1)
    }
    clearPreviews()
  }

  useEffect(() => {
    if (!guideDrag || mode !== "guides") return
    const handleMove = (event: PointerEvent) => {
      const workspace = workspaceRef.current
      if (!workspace) return
      const rect = workspace.getBoundingClientRect()
      const nextValue =
        guideDrag.orientation === "vertical"
          ? (event.clientX - rect.left) / rect.width
          : (event.clientY - rect.top) / rect.height
      moveGuide(guideDrag.orientation, guideDrag.index, nextValue)
    }
    const stop = () => setGuideDrag(null)
    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    return () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
    }
  }, [guideDrag, mode, moveGuide])

  const updateMeshPoint = useCallback(
    (row: number, column: number, rawCandidate: MeshPoint) => {
      if (!sourceMetadata) return false
      const current = meshRef.current
      const candidate = constrainMeshPoint(rawCandidate, row, column, rows, columns)
      const options = {
        sourceWidth: sourceMetadata.width,
        sourceHeight: sourceMetadata.height,
        minEdgePixels: 2,
        minCellAreaPixels: 4,
      }
      if (!isMeshPointMoveValid(current, row, column, candidate, options)) {
        setInvalidMeshMove(true)
        return false
      }
      const nextMesh = current.map((meshRow, rowIndex) =>
        rowIndex === row
          ? meshRow.map((point, columnIndex) => (columnIndex === column ? candidate : point))
          : meshRow
      )
      setInvalidMeshMove(false)
      setNextMesh(nextMesh)
      clearPreviews()
      return true
    },
    [clearPreviews, columns, rows, setNextMesh, sourceMetadata]
  )

  useEffect(() => {
    if (!meshDrag || mode !== "mesh") return
    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== meshDrag.pointerId) return
      const workspace = workspaceRef.current
      if (!workspace) return
      event.preventDefault()
      const rect = workspace.getBoundingClientRect()
      updateMeshPoint(meshDrag.row, meshDrag.column, {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      })
    }
    const stop = (event: PointerEvent) => {
      if (event.pointerId !== meshDrag.pointerId) return
      setMeshDrag(null)
      setInvalidMeshMove(false)
    }
    window.addEventListener("pointermove", handleMove, { passive: false })
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    return () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
    }
  }, [meshDrag, mode, updateMeshPoint])

  const handleGuideKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    orientation: GuideOrientation,
    index: number,
    value: number
  ) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault()
      removeGuide(orientation, index)
      return
    }
    const negativeKey = orientation === "vertical" ? "ArrowLeft" : "ArrowUp"
    const positiveKey = orientation === "vertical" ? "ArrowRight" : "ArrowDown"
    if (event.key !== negativeKey && event.key !== positiveKey) return
    event.preventDefault()
    const step = event.shiftKey ? 0.02 : 0.005
    moveGuide(orientation, index, value + (event.key === positiveKey ? step : -step))
  }

  const handleMeshKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    row: number,
    column: number,
    point: MeshPoint
  ) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return
    event.preventDefault()
    const step = event.shiftKey ? 0.02 : 0.005
    updateMeshPoint(row, column, {
      x: point.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
      y: point.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
    })
  }

  const buildGeometry = (): SliceGeometry => {
    if (mode === "uniform") return { mode, rows, columns }
    if (mode === "guides") return { mode, verticalGuides, horizontalGuides }
    return { mode, mesh: cloneMeshGrid(mesh) }
  }

  const runSlice = async () => {
    if (isSlicing) {
      abortRef.current?.abort()
      return
    }
    if (!sourceFile || !sourceMetadata || gridTooLarge) {
      if (gridTooLarge) setError(replaceTokens(text.tooManySlices, { count: maxSlices }))
      return
    }

    clearPreviews()
    setError(null)
    setProgress(0)
    setIsSlicing(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const slices = await sliceImage(sourceFile, {
        geometry: buildGeometry(),
        filename: sourceMetadata.name,
        signal: controller.signal,
        minGuideGap: MIN_GUIDE_GAP,
        onProgress: ({ completed, total }) => setProgress(Math.round((completed / total) * 100)),
      })
      const nextPreviews = slices.map((slice) => ({ ...slice, previewUrl: URL.createObjectURL(slice.blob) }))
      previewsRef.current = nextPreviews
      setPreviews(nextPreviews)
      setNotice(replaceTokens(text.slicesReady, { count: slices.length }))
      await onSlicesComplete?.(slices)
    } catch (sliceError) {
      const wasCancelled = sliceError instanceof DOMException && sliceError.name === "AbortError"
      setError(wasCancelled ? text.cancelled : sliceError instanceof Error ? sliceError.message : text.sliceFailed)
    } finally {
      abortRef.current = null
      setIsSlicing(false)
      setProgress(0)
    }
  }

  const downloadZip = async () => {
    if (!previews.length || isBusy) return
    setIsPreparingZip(true)
    setError(null)
    try {
      await downloadSlicesAsZip(previews, sourceMetadata?.name || "image-slices")
    } catch {
      setError(text.zipFailed)
    } finally {
      setIsPreparingZip(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    void loadFile(event.dataTransfer.files?.[0])
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const file = Array.from(event.clipboardData.files).find((item) => SUPPORTED_TYPES.has(item.type))
    if (file) void loadFile(file)
  }

  const rootStyle = { "--image-grid-slicer-accent": accentColor } as CSSProperties

  if (!sourceUrl || !sourceMetadata) {
    return (
      <div className={["image-grid-slicer", "image-grid-slicer--empty", className].filter(Boolean).join(" ")} style={rootStyle}>
        <header className="is-brandbar">
          <div>
            <p className="is-eyebrow">SeeAPI open source</p>
            <h1>{text.title}</h1>
            <p>{text.subtitle}</p>
          </div>
          <span className="is-local-badge"><i aria-hidden="true" />{text.localBadge}</span>
        </header>
        <input
          ref={fileInputRef}
          id={inputId}
          className="is-visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            void loadFile(event.target.files?.[0])
            event.target.value = ""
          }}
        />
        <div
          className="is-dropzone"
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              fileInputRef.current?.click()
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          onPaste={handlePaste}
        >
          <span className="is-dropzone__symbol" aria-hidden="true">＋</span>
          <h2>{text.uploadTitle}</h2>
          <p>{text.uploadBody}</p>
          <button type="button" onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click() }}>
            {text.browse}
          </button>
          <small>{replaceTokens(text.uploadFormats, { size: Math.round(maxFileBytes / (1024 * 1024)) })}</small>
        </div>
        {error && <p className="is-alert is-alert--error" role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <div
      className={["image-grid-slicer", className].filter(Boolean).join(" ")}
      style={rootStyle}
      onPaste={handlePaste}
    >
      <input
        ref={fileInputRef}
        id={inputId}
        className="is-visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          void loadFile(event.target.files?.[0])
          event.target.value = ""
        }}
      />

      <header className="is-brandbar is-brandbar--compact">
        <div>
          <p className="is-eyebrow">SeeAPI open source</p>
          <h1>{text.title}</h1>
        </div>
        <span className="is-local-badge"><i aria-hidden="true" />{text.localBadge}</span>
      </header>

      <section className="is-sourcebar" aria-label={text.sourceImage}>
        <div className="is-sourcebar__identity">
          <span className="is-filetype">IMG</span>
          <span>
            <strong>{sourceMetadata.name}</strong>
            <small>{sourceMetadata.width} × {sourceMetadata.height}px</small>
          </span>
        </div>
        <div className="is-sourcebar__actions">
          <button type="button" disabled={isBusy} onClick={() => fileInputRef.current?.click()}>{text.replace}</button>
          <button type="button" disabled={isBusy} onClick={resetAll}>{text.reset}</button>
        </div>
      </section>

      <section className="is-toolbar" aria-label="Slice settings">
        <div className="is-mode-switcher">
          {(["uniform", "guides", "mesh"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={mode === item}
              className={mode === item ? "is-active" : undefined}
              disabled={isBusy}
              onClick={() => changeMode(item)}
            >
              <ModeMark mode={item} />
              <span><strong>{text[item]}</strong><small>{text[`${item}Hint` as const]}</small></span>
            </button>
          ))}
        </div>

        <div className="is-settings-row">
          <div className="is-presets">
            <span>{text.presets}</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={rows === preset.rows && columns === preset.columns ? "is-selected" : undefined}
                disabled={isBusy || preset.rows > safeGridMaximum || preset.columns > safeGridMaximum}
                onClick={() => resetGeometry(preset.rows, preset.columns)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="is-counters">
            <Counter
              id={columnsId}
              label={text.columns}
              value={columns}
              maximum={safeGridMaximum}
              disabled={isBusy}
              decreaseLabel={text.decreaseColumns}
              increaseLabel={text.increaseColumns}
              onChange={(value) => applyGridSize("columns", value)}
            />
            <Counter
              id={rowsId}
              label={text.rows}
              value={rows}
              maximum={safeGridMaximum}
              disabled={isBusy}
              decreaseLabel={text.decreaseRows}
              increaseLabel={text.increaseRows}
              onChange={(value) => applyGridSize("rows", value)}
            />
          </div>
        </div>

        {mode === "guides" && (
          <div className="is-context-tools">
            <button type="button" disabled={isBusy || columns >= safeGridMaximum} onClick={() => addGuide("vertical")}>
              ＋ {text.addVertical}
            </button>
            <button type="button" disabled={isBusy || rows >= safeGridMaximum} onClick={() => addGuide("horizontal")}>
              ＋ {text.addHorizontal}
            </button>
            <p>{text.guideRemoveHint}</p>
          </div>
        )}
        {mode === "mesh" && (
          <div className="is-context-tools">
            <button type="button" disabled={isBusy} onClick={() => setNextMesh(createMeshGrid(rows, columns))}>
              ↺ {text.resetMesh}
            </button>
            <p className={invalidMeshMove ? "is-invalid" : undefined}>{invalidMeshMove ? text.invalidMesh : text.meshHint}</p>
          </div>
        )}
      </section>

      <section className="is-canvas-shell">
        <div className="is-canvas-meta">
          <span>{text.canvasLabel}</span>
          <strong>{columns} × {rows} · {expectedCount} tiles</strong>
        </div>
        <div className="is-workspace-frame">
          <div
            ref={workspaceRef}
            className={["is-workspace", mode === "mesh" ? "is-workspace--mesh" : ""].filter(Boolean).join(" ")}
            style={{
              aspectRatio: `${sourceMetadata.width} / ${sourceMetadata.height}`,
              width: `min(100%, ${(sourceMetadata.width / sourceMetadata.height) * 62}vh)`,
            }}
          >
            <img src={sourceUrl} alt={text.sourceImage} draggable={false} />
            {mode !== "mesh" && (
              <>
                {(mode === "uniform" ? createUniformGuides(columns) : verticalGuides).map((guide, index) => (
                  <button
                    key={`vertical-${index}`}
                    type="button"
                    className={`is-guide is-guide--vertical ${mode === "uniform" ? "is-guide--fixed" : ""}`}
                    style={{ left: `${guide * 100}%` }}
                    tabIndex={mode === "uniform" ? -1 : 0}
                    aria-hidden={mode === "uniform"}
                    aria-label={`${text.addVertical} ${index + 1}`}
                    onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
                      if (mode !== "guides" || isBusy) return
                      event.preventDefault()
                      setGuideDrag({ orientation: "vertical", index })
                    }}
                    onDoubleClick={() => mode === "guides" && removeGuide("vertical", index)}
                    onKeyDown={(event) => handleGuideKey(event, "vertical", index, guide)}
                  ><span /></button>
                ))}
                {(mode === "uniform" ? createUniformGuides(rows) : horizontalGuides).map((guide, index) => (
                  <button
                    key={`horizontal-${index}`}
                    type="button"
                    className={`is-guide is-guide--horizontal ${mode === "uniform" ? "is-guide--fixed" : ""}`}
                    style={{ top: `${guide * 100}%` }}
                    tabIndex={mode === "uniform" ? -1 : 0}
                    aria-hidden={mode === "uniform"}
                    aria-label={`${text.addHorizontal} ${index + 1}`}
                    onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
                      if (mode !== "guides" || isBusy) return
                      event.preventDefault()
                      setGuideDrag({ orientation: "horizontal", index })
                    }}
                    onDoubleClick={() => mode === "guides" && removeGuide("horizontal", index)}
                    onKeyDown={(event) => handleGuideKey(event, "horizontal", index, guide)}
                  ><span /></button>
                ))}
              </>
            )}
            {mode === "mesh" && (
              <>
                <svg className="is-mesh-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {mesh.map((meshRow, rowIndex) => (
                    <polyline key={`row-${rowIndex}`} points={meshRow.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")} />
                  ))}
                  {Array.from({ length: columns + 1 }, (_, columnIndex) => (
                    <polyline key={`column-${columnIndex}`} points={mesh.map((meshRow) => `${meshRow[columnIndex].x * 100},${meshRow[columnIndex].y * 100}`).join(" ")} />
                  ))}
                </svg>
                {mesh.flatMap((meshRow, rowIndex) =>
                  meshRow.map((point, columnIndex) => {
                    const isCorner = (rowIndex === 0 || rowIndex === rows) && (columnIndex === 0 || columnIndex === columns)
                    if (isCorner) return null
                    return (
                      <button
                        key={`point-${rowIndex}-${columnIndex}`}
                        type="button"
                        className="is-mesh-point"
                        style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                        disabled={isBusy}
                        aria-label={`${text.mesh} ${rowIndex + 1}-${columnIndex + 1}`}
                        onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
                          event.preventDefault()
                          setMeshDrag({ row: rowIndex, column: columnIndex, pointerId: event.pointerId })
                        }}
                        onKeyDown={(event) => handleMeshKey(event, rowIndex, columnIndex, point)}
                      />
                    )
                  })
                )}
              </>
            )}
          </div>
        </div>
        <div className="is-runbar">
          <div>
            {isSlicing ? <strong>{replaceTokens(text.slicing, { progress })}</strong> : <strong>{expectedCount} PNG</strong>}
            <span>{mode === "mesh" ? text.meshHint : mode === "guides" ? text.guidesHint : text.uniformHint}</span>
          </div>
          <button
            type="button"
            className="is-primary-action"
            disabled={!isSlicing && (gridTooLarge || isPreparingZip)}
            onClick={() => void runSlice()}
          >
            {isSlicing ? text.cancel : replaceTokens(text.slice, { count: expectedCount })}
          </button>
        </div>
        {isSlicing && <div className="is-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>}
      </section>

      {gridTooLarge && <p className="is-alert is-alert--error" role="alert">{replaceTokens(text.tooManySlices, { count: maxSlices })}</p>}
      {error && <p className="is-alert is-alert--error" role="alert">{error}</p>}
      {notice && <p className="is-alert is-alert--success" role="status">{notice}</p>}

      {previews.length > 0 && (
        <section className="is-results">
          <header>
            <div><p className="is-eyebrow">Export</p><h2>{text.results}</h2></div>
            <button type="button" disabled={isBusy} onClick={() => void downloadZip()}>
              {isPreparingZip ? text.preparingZip : text.downloadZip}
            </button>
          </header>
          <div className="is-results-grid">
            {previews.map((preview) => (
              <article key={preview.id} className="is-result-card">
                <div className="is-result-card__image"><img src={preview.previewUrl} alt={preview.filename} /></div>
                <footer>
                  <span><strong>R{preview.row} · C{preview.column}</strong><small>{preview.width} × {preview.height}px</small></span>
                  <button
                    type="button"
                    disabled={isBusy}
                    aria-label={replaceTokens(text.downloadSlice, { row: preview.row, column: preview.column })}
                    onClick={() => downloadBlob(preview.blob, preview.filename)}
                  >
                    ↓
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
