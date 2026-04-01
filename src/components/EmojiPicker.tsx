import { useEffect, useRef } from 'react'
import { Picker as EmojiMartPicker } from 'emoji-mart'

type EmojiSelection = {
  native?: string
}

type EmojiPickerProps = {
  data: unknown
  onEmojiSelect: (emoji: EmojiSelection) => void
  previewPosition: 'none' | 'top' | 'bottom'
  skinTonePosition: 'none' | 'search' | 'preview'
  theme: 'auto' | 'light' | 'dark'
}

export function EmojiPicker({
  data,
  onEmojiSelect,
  previewPosition,
  skinTonePosition,
  theme,
}: EmojiPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pickerRef = useRef<EmojiMartPicker | null>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    if (!pickerRef.current) {
      pickerRef.current = new EmojiMartPicker({
        data,
        onEmojiSelect,
        previewPosition,
        skinTonePosition,
        theme,
      })
      containerRef.current.replaceChildren(pickerRef.current as unknown as Node)
      return
    }

    pickerRef.current.update({
      data,
      onEmojiSelect,
      previewPosition,
      skinTonePosition,
      theme,
    })
  }, [data, onEmojiSelect, previewPosition, skinTonePosition, theme])

  useEffect(() => {
    return () => {
      containerRef.current?.replaceChildren()
      pickerRef.current = null
    }
  }, [])

  return <div ref={containerRef} />
}
