import { useState } from 'react'

type ImagePreviewProps = {
  src: string
}

export function ImagePreview({ src }: ImagePreviewProps) {
  const [isFullSize, setIsFullSize] = useState(false)

  return (
    <div className="file-preview-image">
      <div className={`file-preview-image__scroll-container ${isFullSize ? 'file-preview-image__scroll-container--full' : ''}`}>
        <img 
          className="file-preview-image__asset" 
          src={src} 
          alt="" 
          onClick={() => setIsFullSize((prev) => !prev)}
        />
      </div>
    </div>
  )
}
