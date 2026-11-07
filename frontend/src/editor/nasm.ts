import { StreamLanguage } from '@codemirror/language'
import type { StringStream } from '@codemirror/language'

// Простая подсветка синтаксиса NASM (Intel) для CodeMirror.
// Мнемоникой считается первое слово строки, которое не метка и не директива.

interface NasmState {
  seenInstruction: boolean
}

const REGISTER =
  /^(?:r(?:[abcd]x|[sd]i|[sb]p)|r(?:[89]|1[0-5])[dwb]?|e[abcd]x|e[sd]i|e[sb]p|[abcd][xlh]|[sd]il?|[sb]pl?|rip|xmm\d+)$/i

const SIZE = /^(?:byte|word|dword|qword|tword|oword|ptr|short|near|far|rel|abs)$/i

const DIRECTIVE =
  /^(?:db|dw|dd|dq|dt|resb|resw|resd|resq|rest|equ|times|section|segment|global|extern|default|bits|align|alignb|org|absolute|cpu)$/i

export const nasm = StreamLanguage.define<NasmState>({
  name: 'nasm',

  startState: () => ({ seenInstruction: false }),

  token(stream: StringStream, state: NasmState) {
    if (stream.sol()) state.seenInstruction = false
    if (stream.eatSpace()) return null

    if (stream.eat(';')) {
      stream.skipToEnd()
      return 'comment'
    }

    if (stream.match(/^(?:"[^"]*"?|'[^']*'?|`(?:[^`\\]|\\.)*`?)/)) return 'string'

    if (stream.match(/^(?:0[xX][0-9a-fA-F]+|[0-9][0-9a-fA-F]*[hH]|0[bB][01]+|[0-9]+)\b/)) {
      return 'number'
    }

    const m = stream.match(/^[%A-Za-z_.$@?][\w.$@?#~]*/)
    if (m && m !== true) {
      const word = m[0]
      if (stream.peek() === ':') return 'def' // метка, двоеточие разберём следующим токеном
      if (word.startsWith('%')) {
        state.seenInstruction = true
        return 'meta'
      }
      if (REGISTER.test(word)) return 'builtin'
      if (SIZE.test(word)) return 'typeName'
      if (DIRECTIVE.test(word)) {
        state.seenInstruction = true
        return 'meta'
      }
      if (!state.seenInstruction) {
        state.seenInstruction = true
        return 'keyword'
      }
      return 'variableName'
    }

    stream.next()
    return null
  },

  languageData: { commentTokens: { line: ';' } },
})