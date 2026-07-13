import type { StandardSchemaV1 } from '@/types/standard-schema.js'

export function createValidSchema<T = any>(transformer?: (val: unknown) => T): StandardSchemaV1<unknown, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value: unknown) {
        const valueResult = transformer ? transformer(value) : (value as T)
        return { value: valueResult }
      },
    },
  }
}

export function createInvalidSchema<T = any>(message = 'Invalid schema payload', path?: Array<string | number | { key: string | number }>): StandardSchemaV1<unknown, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate() {
        return {
          issues: [
            {
              message,
              ...(path ? { path } : {}),
            },
          ],
        }
      },
    },
  }
}

export function createAsyncSchema(): StandardSchemaV1 {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate() {
        return Promise.resolve({ value: 'async-result' })
      },
    },
  }
}
