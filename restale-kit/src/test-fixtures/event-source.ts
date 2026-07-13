export class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = []

  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  readyState: number = MockEventSource.CONNECTING
  onopen: ((this: EventSource, event: Event) => unknown) | null = null
  onerror: ((this: EventSource, event: Event) => unknown) | null = null
  onmessage: ((this: EventSource, event: MessageEvent) => unknown) | null = null

  constructor(
    readonly url: string,
    readonly options?: EventSourceInit
  ) {
    super()
    MockEventSource.instances.push(this)
  }

  emitOpen(): void {
    this.readyState = MockEventSource.OPEN
    const event = new Event('open')
    if (this.onopen) this.onopen.call(this as unknown as EventSource, event)
    this.dispatchEvent(event)
  }

  emitMessage(data: string, lastEventId = ''): void {
    const event = new MessageEvent('message', { data, lastEventId })
    if (this.onmessage) this.onmessage.call(this as unknown as EventSource, event)
    this.dispatchEvent(event)
  }

  emitCustomEvent(type: string, data: string, lastEventId = ''): void {
    const event = new MessageEvent(type, { data, lastEventId })
    this.dispatchEvent(event)
  }

  emitError(errorEvent?: Event): void {
    const event = errorEvent || new Event('error')
    if (this.onerror) this.onerror.call(this as unknown as EventSource, event)
    this.dispatchEvent(event)
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED
  }

  static clear(): void {
    MockEventSource.instances = []
  }
}
