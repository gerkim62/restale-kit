import { SSEClient, type Signal } from 'restale-kit/client'

const statusEl = document.getElementById('status')
const signalsListEl = document.getElementById('signals-list')

let hasReceivedSignals = false

const client = new SSEClient('http://localhost:3000/sse?userId=ada', {
  callback: (signal: Signal | Signal[]) => {
    if (!signalsListEl) return
    if (!hasReceivedSignals) {
      signalsListEl.innerHTML = ''
      hasReceivedSignals = true
    }
    const signals = Array.isArray(signal) ? signal : [signal]
    for (const s of signals) {
      const li = document.createElement('li')
      li.textContent = `[${new Date().toLocaleTimeString()}] Invalidated key: ${JSON.stringify(s.key)}`
      signalsListEl.prepend(li)
    }
  },
})

client.addEventListener('statuschange', (event) => {
  if (!statusEl) return
  const status = event.detail.status
  statusEl.textContent = status
  statusEl.className = `status ${status}`
})

client.connect()
