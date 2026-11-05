import { z } from 'zod';
import { slugField } from './blogs.dto';

/**
 * Series management — a series is a named, blog-scoped sequence of
 * articles (multipart / follow-up posts). Articles join it by carrying
 * `seriesId` + a 1-based `seriesPosition` (see the article DTOs); the
 * public read shape embeds the published-article count as `total`,
 * computed at read time.
 */
export class CreateSeriesDto {
  public static readonly schema = z.object({
    name: z.string().min(1).max(200),
    slug: slugField,
  });

  public name!: string;
  public slug?: string;
}
