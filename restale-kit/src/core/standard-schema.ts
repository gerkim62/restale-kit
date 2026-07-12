/**
 * Standard Schema v1 interface — inlined per the Standard Schema spec's recommendation.
 * @see https://github.com/standard-schema/standard-schema
 *
 * This allows the library to accept validation schemas from any compatible
 * library (Zod, Valibot, ArkType, etc.) without taking a dependency on any of them.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
      options?: { libraryOptions?: Record<string, unknown> }
    ) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>
    readonly types?: {
      readonly input: Input
      readonly output: Output
    }
  }
}

export declare namespace StandardSchemaV1 {
  type Result<Output> = SuccessResult<Output> | FailureResult

  interface SuccessResult<Output> {
    readonly value: Output
    readonly issues?: undefined
  }

  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>
  }

  interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>
  }
}
