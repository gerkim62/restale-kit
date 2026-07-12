import Fastify from 'fastify'
import app from './app.js'

const server = Fastify({ logger: true })
await server.register(app)
await server.listen({ port: 3002, host: '127.0.0.1' })
