import { detectPreviewKind } from '../../../services/fileViewer'
import type { FileInfo } from '../../../types/fileViewer'
import { isHighlightedCodeLanguage, languageFromFilePath, renderHighlightedCodeBlock } from '../codeHighlight'
import { HtmlPreview, type HtmlPreviewResources } from '../preview/HtmlPreview'
import { ImagePreview } from '../preview/ImagePreview'
import { MarkdownPreview } from '../preview/MarkdownPreview'
import { PdfPreview } from '../preview/PdfPreview'

type PreviewViewerProps = {
  file: FileInfo
  /** How an HTML preview reads the project files its page refers to. */
  htmlResources?: HtmlPreviewResources
  previewSourceUrl?: string | null
  text: string
}

export function PreviewViewer({ file, htmlResources, previewSourceUrl, text }: PreviewViewerProps) {
  const previewKind = file.viewerCapabilities?.previewKind ?? detectPreviewKind(file)
  const fileUrl = previewSourceUrl ?? `file://${file.path}`
  const basePath = file.path.replace(/[/\\][^/\\]+$/, '')
  const language = languageFromFilePath(file.path)

  switch (previewKind) {
    case 'image':
      return <ImagePreview src={fileUrl} />
    case 'markdown':
      return <MarkdownPreview text={text} basePath={basePath} />
    case 'pdf':
      return <PdfPreview src={fileUrl} />
    case 'html':
      return <HtmlPreview name={file.name} resources={htmlResources} text={text} />
    case 'text':
      return (
        <pre className={`file-preview-text${isHighlightedCodeLanguage(language) ? ' file-preview-text--highlighted' : ''}`}>
          {renderHighlightedCodeBlock(text, file.path)}
        </pre>
      )
    case 'hex':
    case 'unsupported':
      return <div className="file-preview-unsupported">Preview is not available for this file.</div>
  }
}
