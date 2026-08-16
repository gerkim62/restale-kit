# SSE Query Invalidator

This workspace contains the `restale-kit` package and its universal-signal architecture implementation.

The server emits library-neutral cache signals:

```ts
{ key: ['todos'] }
{ key: ['todos', 1], inlineData: { id: 1 }, markStale: true }
```

Client adapters in `restale-kit/tanstack-query` and `restale-kit/swr` translate those signals into their native cache operations. See [the package README](restale-kit/README.md) and [implementation notes](spec/universal-signal-implementation-notes.md).
