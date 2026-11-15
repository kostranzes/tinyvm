import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { nasm } from './nasm'

// Тема редактора берёт цвета из CSS-переменных страницы (см. index.css).
const theme = EditorView.theme(
  {
    '&': {
      maxHeight: '60vh',
      fontSize: '14px',
      color: 'var(--text)',
      backgroundColor: 'var(--bg)',
      border: '1px solid var(--border)',
    },
    '&.cm-focused': {
      outline: '1px solid var(--text)',
      boxShadow: '0 0 8px rgba(25, 255, 95, 0.35)',
    },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--mono)' },
    '.cm-content, .cm-gutter': { minHeight: '240px' },
    '.cm-content': { caretColor: 'var(--text)' },
    '.cm-cursor': { borderLeftColor: 'var(--text)' },
    '.cm-gutters': {
      color: 'var(--muted)',
      backgroundColor: 'var(--panel)',
      border: 'none',
      borderRight: '1px solid var(--border)',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(25, 255, 95, 0.06)' },
    '.cm-activeLineGutter': {
      color: 'var(--text)',
      backgroundColor: 'rgba(25, 255, 95, 0.1)',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
      { backgroundColor: 'rgba(25, 255, 95, 0.25)' },
    '.cm-panels': {
      color: 'var(--text)',
      backgroundColor: 'var(--panel)',
      borderTop: '1px solid var(--border)',
    },
    '.cm-searchMatch': { backgroundColor: 'rgba(255, 176, 0, 0.3)' },
  },
  { dark: true },
)

// Цвета токенов NASM. Имена токенов задаёт nasm.ts.
const highlight = HighlightStyle.define([
  { tag: t.comment, color: '#2f8f55', fontStyle: 'italic' },
  { tag: t.keyword, color: '#8dffb0', fontWeight: '600' }, // мнемоники
  { tag: t.standard(t.variableName), color: '#ffb000' }, // регистры
  { tag: t.definition(t.variableName), color: '#e8ff5f' }, // метки
  { tag: t.variableName, color: '#19ff5f' },
  { tag: t.number, color: '#4fd8ff' },
  { tag: t.string, color: '#ff9ed2' },
  { tag: t.meta, color: '#c9a2ff' }, // директивы
  { tag: t.typeName, color: '#7fb8ff' }, // byte, qword, ptr...
])

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
          syntaxHighlighting(highlight),
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