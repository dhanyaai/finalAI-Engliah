import { useState } from 'react'

interface ChatInputProps {
  disabled: boolean
  onSend: (text: string) => void
  placeholder?: string
}

export default function ChatInput({
  disabled,
  onSend,
  placeholder = 'Type a message…'
}: ChatInputProps): React.JSX.Element {
  const [value, setValue] = useState('')

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const text = value.trim()
    if (!text || disabled) return
    setValue('')
    onSend(text)
  }

  return (
    <form className="chat-input-form" onSubmit={handleSubmit}>
      <input
        className="chat-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label="Chat message"
        autoFocus
      />
      <button className="chat-input-send" type="submit" disabled={disabled || !value.trim()}>
        Send
      </button>
    </form>
  )
}
