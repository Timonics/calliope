import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';
import { DomainError } from '../../kernel/domain-error';

/**
 * zod-based validation pipe — the ONLY HTTP input validation layer
 * (class-validator is intentionally not used in this workspace).
 *
 * Usage:
 *
 *   1. Global (registered in `main.ts`): validates any parameter whose
 *      declared metatype carries a static `schema` field, e.g.
 *      `class CreateBlogDto { static schema = z.object({...}) }`.
 *   2. Per-route: `@Body(new ZodValidationPipe(createBlogSchema)) dto`.
 *
 * Failed parses throw a `DomainError` (`http.validation.failed` → 400)
 * so the response shape stays `{code, message}`.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  public constructor(private readonly schema?: ZodType) {}

  public transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const metatype = metadata.metatype as { schema?: ZodType } | undefined;
    const schema = this.schema ?? metatype?.schema;
    if (!schema) {
      return value;
    }
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new DomainError(
        'http.validation.failed',
        'Request validation failed',
        {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      );
    }
    return result.data;
  }
}
