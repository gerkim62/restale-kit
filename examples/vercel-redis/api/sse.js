import { openSse } from './_lib.js'

export const maxDuration = 300

export default function handler(req, res) {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : null
  if (!userId) return res.status(400).json({ error: 'userId is required' })
  return openSse(req, res, userId)
}
