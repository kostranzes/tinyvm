import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { nasm } from './nasm'

// Поверх oneDark: наши цвета рамки и фокуса, моноширинный шрифт, высота.
const theme = EditorView.theme(
  {
    '&': {
      maxHeight: '60vh',
      fontSize: '14px',
      border: '1px solid #2a2f3a',
      borderRadius: '6px',
    },
    '&.cm-focused': { outline: '2px solid #4f8cff' },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    },
    '.cm-content, .cm-gutter': { minHeight: '240px' },
  },
  { dark: true },
)

interface Props {
  // Читается один раз при создании. Для другой задачи компонент пересоздаётся (key).
  initialValue: string
  onChange: (value: string) => void
}

export function CodeEditor({ initialValue, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const initialRef = useRef(initialValue)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const parent = containerRef.current
    if (!parent) return

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialRef.current,
        extensions: [
          basicSetup,
          nasm,
          oneDark,
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    return () => view.destroy()
  }, [])

  return <div ref={containerRef} />
}