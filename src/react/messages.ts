export interface ImageGridSlicerMessages {
  title: string
  subtitle: string
  localBadge: string
  uploadTitle: string
  uploadBody: string
  uploadFormats: string
  browse: string
  replace: string
  reset: string
  sourceImage: string
  uniform: string
  uniformHint: string
  guides: string
  guidesHint: string
  mesh: string
  meshHint: string
  presets: string
  columns: string
  rows: string
  decreaseColumns: string
  increaseColumns: string
  decreaseRows: string
  increaseRows: string
  addVertical: string
  addHorizontal: string
  guideRemoveHint: string
  resetMesh: string
  invalidMesh: string
  canvasLabel: string
  slice: string
  slicing: string
  cancel: string
  slicesReady: string
  results: string
  downloadZip: string
  preparingZip: string
  downloadSlice: string
  unsupportedFile: string
  fileTooLarge: string
  imageTooLarge: string
  tooManySlices: string
  cancelled: string
  sliceFailed: string
  zipFailed: string
}

export const defaultImageGridSlicerMessages: ImageGridSlicerMessages = {
  title: "Image Grid Slicer",
  subtitle: "Shape a grid, slice the source, and export clean PNG tiles.",
  localBadge: "Processed locally",
  uploadTitle: "Drop an image here",
  uploadBody: "Paste an image, drag it into this window, or choose one from your device.",
  uploadFormats: "PNG, JPEG, or WebP · up to %size% MB",
  browse: "Choose image",
  replace: "Replace",
  reset: "Reset",
  sourceImage: "Source image",
  uniform: "Uniform",
  uniformHint: "Even rows and columns",
  guides: "Guides",
  guidesHint: "Drag every split line",
  mesh: "Mesh",
  meshHint: "Move connected grid points",
  presets: "Quick layouts",
  columns: "Columns",
  rows: "Rows",
  decreaseColumns: "Decrease columns",
  increaseColumns: "Increase columns",
  decreaseRows: "Decrease rows",
  increaseRows: "Increase rows",
  addVertical: "Add vertical guide",
  addHorizontal: "Add horizontal guide",
  guideRemoveHint: "Double-click a guide to remove it. Arrow keys make precise adjustments.",
  resetMesh: "Reset mesh",
  invalidMesh: "That move would collapse or flip a tile.",
  canvasLabel: "Image slicing canvas",
  slice: "Slice %count% images",
  slicing: "Slicing %progress%%",
  cancel: "Cancel",
  slicesReady: "%count% PNG slices are ready.",
  results: "Results",
  downloadZip: "Download ZIP",
  preparingZip: "Preparing ZIP…",
  downloadSlice: "Download row %row%, column %column%",
  unsupportedFile: "Choose a PNG, JPEG, or WebP image.",
  fileTooLarge: "The selected file is larger than %size% MB.",
  imageTooLarge: "This image contains too many pixels for safe browser processing.",
  tooManySlices: "Reduce the grid to %count% slices or fewer.",
  cancelled: "Slicing cancelled.",
  sliceFailed: "The image could not be sliced.",
  zipFailed: "The ZIP archive could not be created.",
}
