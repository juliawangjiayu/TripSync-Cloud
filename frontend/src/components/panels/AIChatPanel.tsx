import { useState, useRef, useEffect } from 'react'
import DOMPurify from 'dompurify'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface AIChatPanelProps {
  itineraryId: string
}

export default function AIChatPanel({ itineraryId }: AIChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    const newMessages: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setInput('')
    setIsStreaming(true)

    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`/v1/itineraries/${itineraryId}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          history: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      if (!response.body) return

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') break
            const decoded = data.replace(/\\n/g, '\n')
            setMessages((prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last.role === 'assistant') {
                return [...updated.slice(0, -1), { ...last, content: last.content + decoded }]
              }
              return prev
            })
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last.role === 'assistant' && last.content === '') {
          return [...updated.slice(0, -1), { role: 'assistant', content: '(Error: failed to get response)' }]
        }
        return prev
      })
    } finally {
      setIsStreaming(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-8">
            Ask me anything about your itinerary!
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(msg.content),
              }}
            />
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-2 flex gap-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="Ask for travel suggestions..."
          disabled={isStreaming}
          className="flex-1 border rounded text-xs px-2 py-1.5 disabled:opacity-50"
        />
        <button
          onClick={sendMessage}
          disabled={isStreaming || !input.trim()}
          className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded disabled:opacity-40"
        >
          {isStreaming ? '...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
