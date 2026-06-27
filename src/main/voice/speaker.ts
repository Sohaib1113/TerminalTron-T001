import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const JARVIS_VOICE = 'en-GB-RyanNeural'

let ttsReady = false
const tts = new MsEdgeTTS()

async function ensureTtsReady(): Promise<void> {
  if (ttsReady) return
  await tts.setMetadata(JARVIS_VOICE, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS)
  ttsReady = true
}

export async function speakWithNeuralVoice(text: string): Promise<void> {
  const clean = text.replace(/[*#`_]/g, '').slice(0, 500)
  if (!clean.trim()) return

  await ensureTtsReady()
  const mediaPath = join(tmpdir(), `jarvis-${randomUUID()}.webm`)
  const { audioStream } = tts.toStream(clean)
  const chunks: Buffer[] = []

  await new Promise<void>((resolve, reject) => {
    audioStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    audioStream.on('end', () => resolve())
    audioStream.on('error', reject)
  })

  await writeFile(mediaPath, Buffer.concat(chunks))

  try {
    const uri = mediaPath.replace(/\\/g, '/')
    const ps = `
Add-Type -AssemblyName presentationCore
$player = New-Object system.windows.media.mediaplayer
$player.open([uri]::new('${uri}'))
$player.Play()
Start-Sleep -Seconds 1
while ($player.NaturalDuration.TimeSpan.TotalSeconds -eq 0) { Start-Sleep -Milliseconds 100 }
$duration = $player.NaturalDuration.TimeSpan.TotalSeconds
Start-Sleep -Seconds ([math]::Ceiling($duration) + 1)
`
    await execFileAsync('powershell', ['-Command', ps])
  } finally {
    await unlink(mediaPath).catch(() => {})
  }
}
