import { useCallback, useEffect } from 'react'
import { TitleBar } from './components/TitleBar'
import { SystemPanel } from './components/SystemPanel'
import { HudRing } from './components/HudRing'
import { ChatPanel } from './components/ChatPanel'
import { QuickActions } from './components/QuickActions'
import { AlertBanner } from './components/AlertBanner'
import { SettingsPanel } from './components/SettingsPanel'
import { useVoice } from './hooks/useVoice'
import { speakInRenderer } from './lib/speech'
import { useJarvisStore } from './store/jarvisStore'

async function speak(text: string): Promise<void> {
  try {
    await window.jarvis.speak(text)
  } catch {
    await speakInRenderer(text)
  }
}

export default function App() {
  const addMessage = useJarvisStore((s) => s.addMessage)
  const setSystemStats = useJarvisStore((s) => s.setSystemStats)
  const setVoiceState = useJarvisStore((s) => s.setVoiceState)
  const setSettings = useJarvisStore((s) => s.setSettings)
  const pushAlert = useJarvisStore((s) => s.pushAlert)
  const settings = useJarvisStore((s) => s.settings)
  const showSettings = useJarvisStore((s) => s.showSettings)
  const messages = useJarvisStore((s) => s.messages)

  const handleCommand = useCallback(
    async (text: string) => {
      addMessage('user', text)

      const history = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      try {
        setVoiceState('processing')
        const reply = await window.jarvis.chat(text, history)
        addMessage('assistant', reply)
        setVoiceState('speaking')
        await speak(reply)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Something went wrong, sir.'
        addMessage('assistant', msg)
      } finally {
        setVoiceState('idle')
      }
    },
    [addMessage, messages, setVoiceState]
  )

  const { startManualListen } = useVoice(handleCommand)

  useEffect(() => {
    window.jarvis.getSettings().then(setSettings)
  }, [setSettings])

  useEffect(() => {
    const poll = async () => {
      try {
        const stats = await window.jarvis.getSystemStats()
        setSystemStats(stats)
      } catch {
        /* retry next tick */
      }
    }

    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [setSystemStats])

  useEffect(() => {
    return window.jarvis.onVoiceState((state) => {
      if (state === 'speaking' || state === 'idle' || state === 'processing') {
        setVoiceState(state)
      }
    })
  }, [setVoiceState])

  useEffect(() => {
    return window.jarvis.onVoiceFallback(async (text) => {
      await speakInRenderer(text)
    })
  }, [])

  useEffect(() => {
    return window.jarvis.onSettingsChanged(setSettings)
  }, [setSettings])

  useEffect(() => {
    return window.jarvis.onSystemAlert(async (alert) => {
      pushAlert(alert)
      addMessage('system', alert.message)

      const { voiceAlerts } = useJarvisStore.getState().settings
      if (voiceAlerts) {
        setVoiceState('speaking')
        await speak(alert.message)
        setVoiceState('idle')
      }
    })
  }, [addMessage, pushAlert, setVoiceState])

  const overlayMode = settings.overlayMode

  return (
    <div className={`app-shell scanlines ${overlayMode ? 'overlay-mode' : ''}`}>
      <TitleBar />
      <AlertBanner />
      {showSettings && <SettingsPanel />}
      <div className="layout">
        {!overlayMode && <SystemPanel />}
        <div className="panel center-panel">
          <HudRing />
          {!overlayMode ? (
            <ChatPanel onSend={handleCommand} onListen={startManualListen} />
          ) : (
            <div className="overlay-controls">
              <button type="button" className="quick-btn" onClick={startManualListen}>
                MIC
              </button>
              <button type="button" className="quick-btn" onClick={() => window.jarvis.toggleOverlay()}>
                EXPAND
              </button>
            </div>
          )}
        </div>
        {!overlayMode && <QuickActions />}
      </div>
    </div>
  )
}
