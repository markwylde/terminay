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

    const render = async () => {
      const loadingTask = pdfjsLib.getDocument(src)
      const document = await loadingTask.promise
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

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise
    }

    void render()

    return () => {
      disposed = true
    }
  }, [src])

  return (
    <div className="file-preview-pdf">
      <canvas ref={canvasRef} />
    </div>
  )
}
