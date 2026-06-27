import { useCallback, useRef, useEffect } from 'react'
import { useJarvisStore } from '../store/jarvisStore'

type Props = {
  onSend: (text: string) => void
  onListen: () => void
}

export function ChatPanel({ onSend, onListen }: Props) {
  const messages = useJarvisStore((s) => s.messages)
  const inputText = useJarvisStore((s) => s.inputText)
  const setInputText = useJarvisStore((s) => s.setInputText)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const submit = useCallback(() => {
    const text = inputText.trim()
    if (!text) return
    setInputText('')
    onSend(text)
  }, [inputText, onSend, setInputText])

  return (
    <div className="center-stage" style={{ width: '100%' }}>
      <div className="chat-log" ref={logRef}>
        {messages.map((m) => (
          <div
            key={m.id}
            className={`message ${m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'assistant'}`}
          >
            {m.content}
          </div>
        ))}
      </div>
      <div className="input-row">
        <input
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Command JARVIS..."
        />
        <button type="button" onClick={onListen}>
          MIC
        </button>
        <button type="button" onClick={submit}>
          SEND
        </button>
      </div>
    </div>
  )
}
