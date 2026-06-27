import { useEffect, useRef } from 'react'
import { useJarvisStore } from '../store/jarvisStore'
import { WAKE_WORDS } from '@shared/types'

function matchesWakeWord(text: string): boolean {
  const lower = text.toLowerCase().trim()
  return WAKE_WORDS.some((w) => lower.includes(w))
}

export function useVoice(onCommand: (text: string) => void) {
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const setVoiceState = useJarvisStore((s) => s.setVoiceState)
  const setWakeWordActive = useJarvisStore((s) => s.setWakeWordActive)
  const isWakeWordActive = useJarvisStore((s) => s.isWakeWordActive)
  const awaitingCommandRef = useRef(false)

  useEffect(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      console.warn('Speech recognition not available in this environment.')
      return
    }

    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-GB'

    recognition.onstart = () => {
      setWakeWordActive(true)
    }

    recognition.onend = () => {
      setWakeWordActive(false)
      setVoiceState('idle')
      try {
        recognition.start()
      } catch {
        /* already running */
      }
    }

    recognition.onerror = () => {
      setVoiceState('idle')
    }

    recognition.onresult = (event) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }

      if (!transcript.trim()) return

      if (awaitingCommandRef.current) {
        if (event.results[event.results.length - 1].isFinal) {
          setVoiceState('processing')
          awaitingCommandRef.current = false
          onCommand(transcript.trim())
        }
        return
      }

      if (matchesWakeWord(transcript)) {
        setVoiceState('listening')
        awaitingCommandRef.current = true
      }
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
    } catch {
      /* ignore */
    }

    return () => {
      recognition.stop()
    }
  }, [onCommand, setVoiceState, setWakeWordActive])

  const startManualListen = () => {
    setVoiceState('listening')
    awaitingCommandRef.current = true
  }

  return { startManualListen, isWakeWordActive }
}

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition
    webkitSpeechRecognition: typeof SpeechRecognition
  }
}
