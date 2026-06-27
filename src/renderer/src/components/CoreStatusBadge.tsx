import { useEffect, useState } from 'react'
import type { ReasoningCoreStatus } from '@shared/types'

export function CoreStatusBadge() {
  const [status, setStatus] = useState<ReasoningCoreStatus | null>(null)

  useEffect(() => {
    const refresh = () => window.jarvis.getCoreStatus().then(setStatus)
    refresh()
    const id = setInterval(refresh, 15000)
    return () => clearInterval(id)
  }, [])

  if (!status) return null

  const label =
    status.activeProvider === 'ollama'
      ? `OLLAMA · ${status.ollama.model}`
      : status.ollama.serverOnline && !status.ollama.modelReady
        ? 'LOCAL CORE · pull model'
        : 'LOCAL CORE · online'

  return (
    <div className={`core-badge ${status.activeProvider}`} title="JARVIS reasoning engine">
      {label}
    </div>
  )
}
