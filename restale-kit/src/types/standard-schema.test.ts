import { describe, it, expect } from 'vitest'
import { validateStandardSchema } from './standard-schema.js'
import { SchemaValidationError } from './errors.js'
import { createValidSchema, createInvalidSchema, createAsyncSchema } from '@/test-fixtures/schemas.js'

describe('validateStandardSchema', () => {
  it('returns output on successful validation', () => {
    const schema = createValidSchema((input: any) => ({ transformed: String(input) }))
    const result = validateStandardSchema(123, schema)
    expect(result).toEqual({ transformed: '123' })
  })

  it('formats issues with string and { key } object path segments', () => {
    const schema = createInvalidSchema('Field invalid', ['user', { key: 'email' }, 0])
    expect(() => validateStandardSchema({ user: { email: [null] } }, schema)).toThrow(
      SchemaValidationError
    )

    try {
      validateStandardSchema({ user: { email: [null] } }, schema)
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError)
      const error = err as SchemaValidationError
      expect(error.message).toBe('Schema validation failed: user.email.0: Field invalid')
      expect(error.issues).toHaveLength(1)
    }
  })

  it('formats issues without path segments', () => {
    const schema = createInvalidSchema('Payload invalid')
    try {
      validateStandardSchema(null, schema)
    } catch (err) {
      const error = err as SchemaValidationError
      expect(error.message).toBe('Schema validation failed: Payload invalid')
    }
  })

  it('synchronously rejects async schemas', () => {
    const asyncSchema = createAsyncSchema()
    expect(() => validateStandardSchema('test', asyncSchema)).toThrow(SchemaValidationError)
    try {
      validateStandardSchema('test', asyncSchema)
    } catch (err) {
      const error = err as SchemaValidationError
      expect(error.message).toContain('async schemas are not supported')
    }
  })
})
