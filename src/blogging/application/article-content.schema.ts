import { z } from 'zod';

/**
 * Article `content` is a JSON block list (structured-editor output),
 * deliberately CMS-agnostic: a block is `{ type, data }` where `type`
 * is any non-empty string and `data` is a JSON object. Unknown block
 * types are ALLOWED — any editor can plug in its own block vocabulary;
 * only the shape is enforced here. Richer per-type schemas belong to
 * the clients that render the blocks.
 */
export const articleContentBlockSchema = z.object({
  type: z.string().min(1).max(200),
  // zod v4 has no `ZodRecord.max` — cap the key count with a refine.
  data: z
    .record(z.string(), z.unknown())
    .refine((value) => Object.keys(value).length <= 100, {
      message: 'at most 100 data keys per block',
    }),
});

export const articleContentSchema = z
  .array(articleContentBlockSchema)
  .min(1, 'Article content must contain at least one block')
  .max(200, 'Article content accepts at most 200 blocks');

export type ArticleContentBlock = z.infer<typeof articleContentBlockSchema>;
export type ArticleContent = z.infer<typeof articleContentSchema>;
