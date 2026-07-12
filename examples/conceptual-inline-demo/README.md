# Conceptual Inline Demo (Standalone)

This directory contains a standalone proof of concept of the `restale-kit` contract. 

**It does NOT import or use the `restale-kit` packages directly.** Instead, it implements the SSE wire protocol and client-side logic inline to demonstrate and validate the specification before implementation.

## Structure
- `/client`: React + TanStack Query application. The `useReStale` hook and `tanstackAdapter` are implemented inline in `src/App.tsx`.
- `/server`: Express server. The SSE connection handling, keepalive intervals, and event broadcasting are implemented inline in `server.ts`.

## Purpose
This serves as a conceptual baseline to ensure the contract is sound, functional, and achieves the desired real-time sync behavior before compiling the actual library code.
