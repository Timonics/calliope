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
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export const articleContentSchema = z
  .array(articleContentBlockSchema)
  .min(1, 'Article content must contain at least one block');

export type ArticleContentBlock = z.infer<typeof articleContentBlockSchema>;
export type ArticleContent = z.infer<typeof articleContentSchema>;
