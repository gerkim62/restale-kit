import type { StandardSchemaV1 } from '@/types/standard-schema'

export function createValidSchema<T = unknown>(transformer?: (val: unknown) => T): StandardSchemaV1<unknown, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test-fixture',
      validate(value: unknown) {
        return { value: transformer ? transformer(value) : (value as T) }
      },
    },
  }
}

export function createInvalidSchema<T = never>(
  message = 'Invalid schema payload',
  path?: Array<string | number | { key: string | number }>
): StandardSchemaV1<unknown, T> {
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
