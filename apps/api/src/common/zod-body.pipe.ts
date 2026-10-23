import { PipeTransform } from '@nestjs/common';
import { DomainError } from './domain-error';

interface SafeParseSchema<T> {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

/** `@Body(ZodBody(schema))`: 400 VALIDATION_FAILED with details.issues on bad input. */
export function ZodBody<T>(schema: SafeParseSchema<T>): PipeTransform<unknown, T> {
  return {
    transform(value: unknown): T {
      const result = schema.safeParse(value);
      if (result.success) return result.data;
      throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
        issues: result.error.issues.map((i) => ({
          path: i.path.map(String).join('.'),
          message: i.message,
        })),
      });
    },
  };
}
