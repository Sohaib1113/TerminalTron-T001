export async function speakInRenderer(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('Speech synthesis unavailable'))
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-GB'
    utterance.rate = 0.95
    utterance.pitch = 0.9

    const voices = window.speechSynthesis.getVoices()
    const british =
      voices.find((v) => v.name.includes('Ryan')) ||
      voices.find((v) => v.lang.startsWith('en-GB')) ||
      voices.find((v) => v.lang.startsWith('en'))

    if (british) utterance.voice = british

    utterance.onend = () => resolve()
    utterance.onerror = () => reject(new Error('Speech synthesis failed'))
    window.speechSynthesis.speak(utterance)
  })
}
