import { ImageGridSlicer } from "../src/react"

export function App() {
  return (
    <main className="demo-page">
      <nav className="demo-nav" aria-label="Project navigation">
        <a className="demo-logo" href="https://github.com/SeeAPI" target="_blank" rel="noreferrer">
          <span aria-hidden="true">S</span>
          SeeAPI
        </a>
        <a href="https://github.com/SeeAPI/image-grid-slicer" target="_blank" rel="noreferrer">
          View source <span aria-hidden="true">↗</span>
        </a>
      </nav>

      <section className="demo-intro">
        <p>Browser-native image tooling</p>
        <h1>One image.<br />Every tile you need.</h1>
        <div>
          <p>
            Build an even grid, tune individual guides, or shape a connected mesh. Your source stays on your device.
          </p>
          <ul>
            <li><span>01</span> No upload</li>
            <li><span>02</span> Transparent PNG</li>
            <li><span>03</span> ZIP export</li>
          </ul>
        </div>
      </section>

      <ImageGridSlicer />

      <footer className="demo-footer">
        <p>Image Grid Slicer is open source software by SeeAPI.</p>
        <a href="https://github.com/SeeAPI/image-grid-slicer/blob/main/LICENSE" target="_blank" rel="noreferrer">MIT License</a>
      </footer>
    </main>
  )
}
