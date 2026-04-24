import { useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type PdfPreviewProps = {
  src: string
}

export function PdfPreview({ src }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let disposed = false
    let document: pdfjsLib.PDFDocumentProxy | null = null
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null
    let renderTask: pdfjsLib.RenderTask | null = null

    const render = async () => {
      loadingTask = pdfjsLib.getDocument(src)
      document = await loadingTask.promise
      const page = await document.getPage(1)
      const viewport = page.getViewport({ scale: 1.2 })
      const canvas = canvasRef.current
      if (!canvas || disposed) {
        return
      }

      const context = canvas.getContext('2d')
      if (!context) {
        return
      }

      canvas.width = viewport.width
      canvas.height = viewport.height

      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
      })
      await renderTask.promise
    }

    void render().catch(() => undefined)

    return () => {
      disposed = true
      renderTask?.cancel()
      loadingTask?.destroy()
      void document?.destroy()
    }
  }, [src])

  return (
    <div className="file-preview-pdf">
      <canvas ref={canvasRef} />
    </div>
  )
}
