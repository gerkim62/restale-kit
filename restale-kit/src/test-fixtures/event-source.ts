export class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = []

  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  readyState: number = MockEventSource.CONNECTING
  onopen: ((event: Event) => unknown) | null = null
  onerror: ((event: Event) => unknown) | null = null
  onmessage: ((event: MessageEvent) => unknown) | null = null

  constructor(
    readonly url: string,
    readonly options?: EventSourceInit
  ) {
    super()
    MockEventSource.instances.push(this)
  }

  emitOpen(openEvent?: Event, connectionId = 'mock-conn-id'): void {
    this.readyState = MockEventSource.OPEN
    const event = openEvent || new Event('open')
    if (this.onopen) this.onopen(event)
    this.dispatchEvent(event)
    if (connectionId) {
      this.emitConnected(connectionId)
    }
  }

  emitConnected(connectionId: string): void {
    this.emitCustomEvent('connected', JSON.stringify({ connectionId }))
  }

  emitMessage(data: string, lastEventId = ''): void {
    const event = new MessageEvent('message', { data, lastEventId })
    if (this.onmessage) this.onmessage(event)
    this.dispatchEvent(event)
  }

  emitCustomEvent(type: string, data: string, lastEventId = ''): void {
    const event = new MessageEvent(type, { data, lastEventId })
    this.dispatchEvent(event)
  }

  emitError(errorEvent?: Event): void {
    const event = errorEvent || new Event('error')
    if (this.onerror) this.onerror(event)
    this.dispatchEvent(event)
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED
  }

  static clear(): void {
    MockEventSource.instances = []
  }
}
