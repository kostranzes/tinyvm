import { startChatServer } from './chat.js'

async function main() {
  const port = Number(process.env.CHAT_PORT ?? 8080)
  const allowedOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173'

  const chat = await startChatServer({ port, allowedOrigin })
  console.log(`WebSocket-чат: ws://localhost:${chat.port}, Origin: ${allowedOrigin}`)

  process.on('SIGINT', () => {
    void chat.close().then(() => process.exit(0))
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})