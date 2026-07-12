# Interchangeable examples

`shared/` contains the Todo domain contract: request validation, types, the in-memory Todo API, and the ReStale invalidation signal schema. It has no dependency on a web framework, cache, or frontend.

`backend/` contains equivalent HTTP/SSE implementations of that contract:

- `express` — Node adapter on port 3000
- `hono` — Fetch adapter on port 3001
- `fastify` — Node adapter on port 3002
- `node` — Node adapter on port 3003

`frontend/` contains cache/UI implementations. `react-query` is the first one and can select any backend from its Server control. Its Vite proxy preserves same-origin EventSource requests while routing to the selected backend.

Run the frontend and one backend in separate terminals:

```sh
pnpm dev:client
pnpm dev:hono
```

The frontend is intentionally independent of the backend choice. Future frontends such as `frontend/react-swr` or `frontend/vue-query` import `@restale-kit-example/shared` and use the same `/todos` and `/sse` contract; future backends import the same package and expose that contract.
