import { useJarvisStore } from '../store/jarvisStore'

export function HudRing() {
  const voiceState = useJarvisStore((s) => s.voiceState)
  const isWakeWordActive = useJarvisStore((s) => s.isWakeWordActive)

  const stateClass = voiceState !== 'idle' ? voiceState : ''
  const label =
    voiceState === 'listening'
      ? 'Listening...'
      : voiceState === 'processing'
        ? 'Processing...'
        : voiceState === 'speaking'
          ? 'Speaking'
          : isWakeWordActive
            ? 'Say "Jarvis"'
            : 'Standby'

  return (
    <div className={`ring-container ${stateClass}`}>
      <div className="ring ring-outer" />
      <div className="ring ring-middle" />
      <div className="ring ring-inner" />
      <div className="arc-reactor" />
      <div className={`voice-label ${voiceState !== 'idle' || isWakeWordActive ? 'active' : ''}`}>{label}</div>
    </div>
  )
}
