/**
 * Gap 9: Client target and event-payload type can contradict each other
 * 
 * SSEInvalidatorClient has independent TSignal and ClientOptions.target, allowing:
 *   new SSEInvalidatorClient<SWRSignal>(url, { target: 'tanstack-query' })
 * 
 * Events are typed as SWR while the negotiated connection asks for TanStack.
 * makeAdaptedCallback has the same issue: its target brand is independent of
 * the callback's signal type.
 */

import { describe, it, expect } from 'vitest';
import { SSEInvalidatorClient } from '../../client/core/sse-client.js';
import { makeAdaptedCallback } from '../../client/core/callback.js';
import type { SWRSignal, TanStackQuerySignal, RTKQuerySignal } from '../../types/protocol.js';

describe('Gap 9: Client target and payload type alignment', () => {
  describe('SSEInvalidatorClient generic/target consistency', () => {
    it('should reject SWRSignal generic with tanstack-query target', () => {
      const url = 'http://localhost/sse';
      
      // @ts-expect-error - Signal type must match target
      const client = new SSEInvalidatorClient<SWRSignal>(url, {
        target: 'tanstack-query'
      });
    });

    it('should reject TanStackQuerySignal generic with swr target', () => {
      const url = 'http://localhost/sse';
      
      // @ts-expect-error - Signal type must match target
      const client = new SSEInvalidatorClient<TanStackQuerySignal>(url, {
        target: 'swr'
      });
    });

    it('should reject RTKQuerySignal generic with swr target', () => {
      const url = 'http://localhost/sse';
      
      // @ts-expect-error - Signal type must match target
      const client = new SSEInvalidatorClient<RTKQuerySignal>(url, {
        target: 'swr'
      });
    });

    it('should accept matching SWRSignal generic with swr target', () => {
      const url = 'http://localhost/sse';
      
      const client = new SSEInvalidatorClient<SWRSignal>(url, {
        target: 'swr',
        callback: () => {}
      });
      
      expect(client).toBeDefined();
    });

    it('should accept matching TanStackQuerySignal generic with tanstack-query target', () => {
      const url = 'http://localhost/sse';
      
      const client = new SSEInvalidatorClient<TanStackQuerySignal>(url, {
        target: 'tanstack-query',
        callback: () => {}
      });
      
      expect(client).toBeDefined();
    });

    it('should accept matching RTKQuerySignal generic with rtk-query target', () => {
      const url = 'http://localhost/sse';
      
      const client = new SSEInvalidatorClient<RTKQuerySignal>(url, {
        target: 'rtk-query',
        callback: () => {}
      });
      
      expect(client).toBeDefined();
    });
  });

  describe('Generic fallback for multi-target scenarios', () => {
    it('should allow InvalidateSignal generic with any specific target', () => {
      const url = 'http://localhost/sse';
      
      // Generic fallback is intentionally broad for adapters that support multiple targets
      // This should be allowed only when adapter deliberately supports it
      const client = new SSEInvalidatorClient(url, {
        target: 'swr',
        callback: () => {}
      });
      
      expect(client).toBeDefined();
    });

    it('should type events correctly based on generic parameter', () => {
      const url = 'http://localhost/sse';
      
      const client = new SSEInvalidatorClient<SWRSignal>(url, {
        target: 'swr',
        callback: (signal) => {
          // Signal should be typed as SWRSignal
          const key = signal.key;
          expect(Array.isArray(key)).toBe(true);
          
          // @ts-expect-error - Should not have TanStack properties
          const queryKey = signal.queryKey;
        }
      });
    });
  });

  describe('makeAdaptedCallback brand/signal alignment', () => {
    it('should reject SWR callback branded as TanStack', () => {
      // @ts-expect-error - Callback signal type must match target brand
      const callback = makeAdaptedCallback<SWRSignal>(
        (signal) => {
          const key = signal.key;
        },
        'tanstack-query'
      );
    });

    it('should reject TanStack callback branded as SWR', () => {
      // @ts-expect-error - Callback signal type must match target brand
      const callback = makeAdaptedCallback<TanStackQuerySignal>(
        (signal) => {
          const queryKey = signal.queryKey;
        },
        'swr'
      );
    });

    it('should accept matching SWR callback and brand', () => {
      const callback = makeAdaptedCallback<SWRSignal>(
        (signal) => {
          const key = signal.key;
          expect(Array.isArray(key)).toBe(true);
        },
        'swr'
      );
      
      expect(callback.target).toBe('swr');
    });

    it('should accept matching TanStack callback and brand', () => {
      const callback = makeAdaptedCallback<TanStackQuerySignal>(
        (signal) => {
          const queryKey = signal.queryKey;
          expect(Array.isArray(queryKey)).toBe(true);
        },
        'tanstack-query'
      );
      
      expect(callback.target).toBe('tanstack-query');
    });

    it('should accept matching RTK callback and brand', () => {
      const callback = makeAdaptedCallback<RTKQuerySignal>(
        (signal) => {
          const tags = signal.tags;
          expect(Array.isArray(tags)).toBe(true);
        },
        'rtk-query'
      );
      
      expect(callback.target).toBe('rtk-query');
    });
  });

  describe('Callback type safety in client options', () => {
    it('should enforce callback parameter type matches client generic', () => {
      const url = 'http://localhost/sse';
      
      const client = new SSEInvalidatorClient<SWRSignal>(url, {
        target: 'swr',
        callback: (signal) => {
          // Signal parameter should be SWRSignal
          const key = signal.key;
          
          // @ts-expect-error - Not a TanStack signal
          const queryKey = signal.queryKey;
        }
      });
    });

    it('should type onConnect context correctly', () => {
      const url = 'http://localhost/sse';
      
      const client = new SSEInvalidatorClient<TanStackQuerySignal>(url, {
        target: 'tanstack-query',
        callback: () => {},
        onConnect: (event) => {
          expect(event.type).toBe('connect');
          // Context is properly typed
        }
      });
    });

    it('should type onDisconnect context correctly', () => {
      const url = 'http://localhost/sse';
      
      const client = new SSEInvalidatorClient<RTKQuerySignal>(url, {
        target: 'rtk-query',
        callback: () => {},
        onDisconnect: (event) => {
          expect(event.type).toBe('disconnect');
        }
      });
    });
  });

  describe('Runtime validation matches type constraints', () => {
    it('should validate signal format against declared target', () => {
      const url = 'http://localhost/sse';
      let receivedSignal: any;
      
      const client = new SSEInvalidatorClient<SWRSignal>(url, {
        target: 'swr',
        callback: (signal) => {
          receivedSignal = signal;
          // Should receive SWR-formatted signal
          expect('key' in signal).toBe(true);
        }
      });
      
      // If server sends wrong format, client validation should catch it
    });

    it('should reject malformed signals at runtime', () => {
      const url = 'http://localhost/sse';
      const errors: any[] = [];
      
      const client = new SSEInvalidatorClient<TanStackQuerySignal>(url, {
        target: 'tanstack-query',
        callback: () => {},
        onError: (error) => {
          errors.push(error);
        }
      });
      
      // Client should validate incoming events match expected format
    });
  });

  describe('Custom signal types with appropriate adapters', () => {
    it('should allow custom signal extending base type with matching target', () => {
      const url = 'http://localhost/sse';
      
      interface CustomSWRSignal extends SWRSignal {
        metadata?: Record<string, string>;
      }
      
      const client = new SSEInvalidatorClient<CustomSWRSignal>(url, {
        target: 'swr',
        callback: (signal) => {
          const key = signal.key;
          const metadata = signal.metadata;
        }
      });
      
      expect(client).toBeDefined();
    });

    it('should reject custom signal not extending base type even with matching target name', () => {
      const url = 'http://localhost/sse';
      
      interface UnrelatedSignal {
        target: 'swr'; // target field matches but structure doesn't
        data: unknown;
      }
      
      // @ts-expect-error - Structure doesn't extend SWRSignal
      const client = new SSEInvalidatorClient<UnrelatedSignal>(url, {
        target: 'swr',
        callback: () => {}
      });
    });
  });

  describe('Union types for multi-target clients', () => {
    it('should support union generic for clients that handle multiple targets', () => {
      const url = 'http://localhost/sse';
      
      type MultiSignal = SWRSignal | TanStackQuerySignal;
      
      const client = new SSEInvalidatorClient<MultiSignal>(url, {
        // For union, target might be omitted or matched against union
        callback: (signal) => {
          if ('key' in signal) {
            // SWR signal
            const key = signal.key;
          } else if ('queryKey' in signal) {
            // TanStack signal
            const queryKey = signal.queryKey;
          }
        }
      });
    });

    it('should narrow union type in callback based on discriminator', () => {
      const url = 'http://localhost/sse';
      
      type MultiSignal = SWRSignal | TanStackQuerySignal | RTKQuerySignal;
      
      const client = new SSEInvalidatorClient<MultiSignal>(url, {
        callback: (signal) => {
          // Type narrowing should work
          if (signal.target === 'swr') {
            const key = signal.key;
          } else if (signal.target === 'tanstack-query') {
            const queryKey = signal.queryKey;
          } else if (signal.target === 'rtk-query') {
            const tags = signal.tags;
          }
        }
      });
    });
  });

  describe('Integration with adapter factories', () => {
    it('should maintain type safety through adapter creation chain', () => {
      const url = 'http://localhost/sse';
      
      // Creating adapted callback
      const adaptedCallback = makeAdaptedCallback<SWRSignal>(
        (signal) => {
          const key = signal.key;
        },
        'swr'
      );
      
      // Using in client - types should align
      const client = new SSEInvalidatorClient<SWRSignal>(url, {
        target: 'swr',
        callback: adaptedCallback
      });
      
      expect(client).toBeDefined();
    });

    it('should reject adapter callback with mismatched target', () => {
      const url = 'http://localhost/sse';
      
      const swrCallback = makeAdaptedCallback<SWRSignal>(
        (signal) => {},
        'swr'
      );
      
      // @ts-expect-error - Callback target doesn't match client target
      const client = new SSEInvalidatorClient<TanStackQuerySignal>(url, {
        target: 'tanstack-query',
        callback: swrCallback
      });
    });
  });

  describe('Event stream typing', () => {
    it('should type message events with correct signal type', () => {
      const url = 'http://localhost/sse';
      
      const client = new SSEInvalidatorClient<SWRSignal>(url, {
        target: 'swr',
        callback: (signal) => {
          // Event should be typed as containing SWRSignal
          expect('key' in signal).toBe(true);
        }
      });
    });

    it('should handle error events with proper context', () => {
      const url = 'http://localhost/sse';
      let errorReceived = false;
      
      const client = new SSEInvalidatorClient<TanStackQuerySignal>(url, {
        target: 'tanstack-query',
        callback: () => {},
        onError: (error) => {
          errorReceived = true;
          expect(error).toBeDefined();
        }
      });
    });
  });
});
