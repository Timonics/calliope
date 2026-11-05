/**
 * Database seed — the local dev fixture for the extended article
 * contract (series / featured / corrections / coverImage).
 *
 * Everything uses DETERMINISTIC ids so the blog frontend build (prev/next
 * navigation, topic threads, hero picking) can hardcode references:
 *
 *   * tenant `11111111-…` (a made-up cerberus org UUID — no real cerberus
 *     organization is touched) owns blog `main`;
 *   * published articles 1+2 are parts of the ONE series
 *     `shipping-calliope` and SHARE the tag `api-design` — the frontend
 *     builds prev/next and topic threads from exactly that pair;
 *   * exactly one published article is `featured: true`;
 *   * every article carries excerpt, coverImage (alt/width/height),
 *     readingTimeMinutes and at least one `h2` block;
 *   * the release-notes article has a corrections entry (banner path);
 *   * the release-notes article is created as a draft and published by a
 *     SECOND write, so its `updatedAt` is a real, later modification
 *     time (and its `createdAt` sits in the past);
 *   * one draft and one archived article prove the public routes filter
 *     by status.
 *
 * Safe to re-run: deletes the dev blog (cascading) before re-inserting.
 * NEVER point this at a database you care about.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// --- deterministic ids -------------------------------------------------------

const DEV_TENANT = '11111111-1111-4111-8111-111111111111';
const BLOG = { id: '22222222-2222-4222-8222-222222222222', slug: 'main' };

const AUTHORS = {
  ada: {
    id: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
    name: 'Ada Lovelace',
    bio: 'API designer. Counting cards since 1843.',
    avatarUrl: 'https://i.pravatar.cc/300?img=47',
    links: [
      { label: 'GitHub', url: 'https://github.com/ada-lovelace' },
      { label: 'Website', url: 'https://ada.example.com' },
    ],
  },
  grace: {
    id: 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2',
    name: 'Grace Hopper',
    bio: null,
    avatarUrl: null,
    links: [],
  },
};

const CATEGORIES = {
  engineering: {
    id: 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
    name: 'Engineering',
    slug: 'engineering',
    description: 'How calliope is built.',
  },
  product: {
    id: 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2',
    name: 'Product',
    slug: 'product',
    description: null,
  },
};

const TAGS = {
  apiDesign: {
    id: 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1',
    name: 'API Design',
    slug: 'api-design',
  },
  postgres: {
    id: 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2',
    name: 'Postgres',
    slug: 'postgres',
  },
  releaseNotes: {
    id: 'b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3',
    name: 'Release Notes',
    slug: 'release-notes',
  },
};

const SERIES = {
  id: 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
  name: 'Shipping Calliope',
  slug: 'shipping-calliope',
};

const ARTICLES = {
  part1: {
    id: 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1',
    slug: 'shipping-calliope-part-1-data-contract',
    title: 'Shipping Calliope, Part 1: The Data Contract',
  },
  part2: {
    id: 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2',
    slug: 'shipping-calliope-part-2-auth-and-tenancy',
    title: 'Shipping Calliope, Part 2: Auth and Tenancy',
  },
  release: {
    id: 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3',
    slug: 'calliope-1-0-release-notes',
    title: 'Calliope 1.0: Release Notes',
  },
  draft: {
    id: 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4',
    slug: 'designing-the-calliope-api',
    title: 'Designing the Calliope API',
  },
  archived: {
    id: 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5',
    slug: 'calliope-0-1-alpha',
    title: 'Calliope 0.1 Alpha',
  },
};

// --- helpers -----------------------------------------------------------------

const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);

const cover = (
  seed: string,
  alt: string,
): {
  url: string;
  alt: string;
  caption: null;
  credit: string;
  width: number;
  height: number;
} => ({
  url: `https://picsum.photos/seed/${seed}/1600/900`,
  alt,
  caption: null,
  credit: 'Placeholder images via picsum.photos',
  width: 1600,
  height: 900,
});

const paragraph = (text: string): { type: string; data: { text: string } } => ({
  type: 'paragraph',
  data: { text },
});

const h2 = (text: string): { type: string; data: { text: string } } => ({
  type: 'h2',
  data: { text },
});

// --- seed --------------------------------------------------------------------

async function main(): Promise<void> {
  // Re-runnable: the dev blog owns everything below (all models cascade).
  await prisma.blog.deleteMany({ where: { id: BLOG.id } });

  await prisma.blog.create({
    data: {
      id: BLOG.id,
      tenantId: DEV_TENANT,
      name: 'Calliope Dev Blog',
      slug: BLOG.slug,
    },
  });

  for (const author of Object.values(AUTHORS)) {
    await prisma.author.create({
      data: { ...author, blogId: BLOG.id },
    });
  }
  for (const category of Object.values(CATEGORIES)) {
    await prisma.category.create({
      data: { ...category, blogId: BLOG.id },
    });
  }
  for (const tag of Object.values(TAGS)) {
    await prisma.tag.create({ data: { ...tag, blogId: BLOG.id } });
  }
  await prisma.series.create({
    data: { ...SERIES, blogId: BLOG.id },
  });

  const PUBLISHED = 'PUBLISHED' as const;

  // Part 1 — series position 1, shares `api-design` with part 2.
  await prisma.article.create({
    data: {
      id: ARTICLES.part1.id,
      blogId: BLOG.id,
      authorId: AUTHORS.ada.id,
      categoryId: CATEGORIES.engineering.id,
      title: ARTICLES.part1.title,
      subtitle: 'Why the schema is the contract',
      slug: ARTICLES.part1.slug,
      excerpt:
        'Every field calliope serves is decided before a line of UI is written.',
      content: [
        h2('The schema is the contract'),
        paragraph(
          'We started from the JSON the blog renders, not from the tables that store it.',
        ),
        paragraph('This post is part 1 of the Shipping Calliope series.'),
      ],
      coverImage: cover(
        'calliope-part1',
        'A blueprint of the calliope article JSON shape',
      ),
      coverImageUrl: 'https://picsum.photos/seed/calliope-part1/1600/900',
      featured: false,
      seriesId: SERIES.id,
      seriesPosition: 1,
      readingTimeMinutes: 4,
      canonicalUrl: null,
      locale: 'en',
      corrections: [],
      seo: {
        socialTitle: 'Shipping Calliope, Part 1: The Data Contract',
        socialDescription: 'Schema-first blogging at timonics.',
        noIndex: false,
      },
      status: PUBLISHED,
      publishedAt: daysAgo(9),
      createdAt: daysAgo(10),
      relatedArticleIds: [ARTICLES.part2.id],
      tags: { connect: [{ id: TAGS.apiDesign.id }, { id: TAGS.postgres.id }] },
    },
  });

  // Part 2 — series position 2, shares `api-design` with part 1.
  await prisma.article.create({
    data: {
      id: ARTICLES.part2.id,
      blogId: BLOG.id,
      authorId: AUTHORS.ada.id,
      categoryId: CATEGORIES.engineering.id,
      title: ARTICLES.part2.title,
      subtitle: 'Cerberus tokens end to end',
      slug: ARTICLES.part2.slug,
      excerpt:
        'Tenancy is an org claim on a JWT, checked once at the blog boundary.',
      content: [
        h2('One guard, every route'),
        paragraph(
          'Every management route passes through the same blog-access choke point.',
        ),
        paragraph('This post is part 2 of the Shipping Calliope series.'),
      ],
      coverImage: cover(
        'calliope-part2',
        'A sequence diagram of a cerberus JWT verification',
      ),
      coverImageUrl: 'https://picsum.photos/seed/calliope-part2/1600/900',
      featured: false,
      seriesId: SERIES.id,
      seriesPosition: 2,
      readingTimeMinutes: 6,
      canonicalUrl: 'https://medium.com/timonics/calliope-auth-and-tenancy',
      locale: 'en',
      corrections: [],
      seo: {},
      status: PUBLISHED,
      publishedAt: daysAgo(7),
      createdAt: daysAgo(8),
      relatedArticleIds: [ARTICLES.part1.id],
      tags: { connect: [{ id: TAGS.apiDesign.id }] },
    },
  });

  // Release notes — the featured hero, with a corrections entry. Created
  // as a DRAFT and published by a second write so `updatedAt` is a real,
  // later modification time (the contract requires it to be honest).
  await prisma.article.create({
    data: {
      id: ARTICLES.release.id,
      blogId: BLOG.id,
      authorId: AUTHORS.grace.id,
      categoryId: CATEGORIES.product.id,
      title: ARTICLES.release.title,
      subtitle: null,
      slug: ARTICLES.release.slug,
      excerpt:
        'Calliope 1.0 ships the extended article contract: series, featured posts, corrections.',
      content: [
        h2('What is new in 1.0'),
        paragraph(
          'Series, featured articles, corrections and structured cover images.',
        ),
        paragraph(
          'All of it is visible in the public JSON, no extra calls needed.',
        ),
      ],
      coverImage: cover(
        'calliope-release',
        'Confetti over a terminal running calliope 1.0',
      ),
      coverImageUrl: 'https://picsum.photos/seed/calliope-release/1600/900',
      featured: true,
      seriesId: null,
      seriesPosition: null,
      readingTimeMinutes: 3,
      canonicalUrl: null,
      locale: 'en',
      corrections: [],
      seo: {},
      status: 'DRAFT',
      publishedAt: null,
      createdAt: daysAgo(4),
      relatedArticleIds: [],
      tags: { connect: [{ id: TAGS.releaseNotes.id }] },
    },
  });
  // The genuine second write: publish. Bumps `updatedAt` to now.
  await prisma.article.update({
    where: { id: ARTICLES.release.id },
    data: {
      status: PUBLISHED,
      publishedAt: daysAgo(1),
      corrections: [
        {
          date: daysAgo(1).toISOString(),
          note: 'Fixed the stated default page size (it is 25, not 50).',
        },
      ],
    },
  });

  // A draft and an archived article — public routes must never serve them.
  await prisma.article.create({
    data: {
      id: ARTICLES.draft.id,
      blogId: BLOG.id,
      authorId: AUTHORS.ada.id,
      categoryId: CATEGORIES.engineering.id,
      title: ARTICLES.draft.title,
      subtitle: null,
      slug: ARTICLES.draft.slug,
      excerpt: 'A draft, visible to management routes only.',
      content: [h2('Draft'), paragraph('Work in progress.')],
      coverImage: cover('calliope-draft', 'A half-erased whiteboard'),
      coverImageUrl: 'https://picsum.photos/seed/calliope-draft/1600/900',
      featured: false,
      seriesId: null,
      seriesPosition: null,
      readingTimeMinutes: 2,
      canonicalUrl: null,
      locale: 'en',
      corrections: [],
      seo: {},
      status: 'DRAFT',
      publishedAt: null,
      relatedArticleIds: [],
      tags: { connect: [{ id: TAGS.apiDesign.id }] },
    },
  });
  await prisma.article.create({
    data: {
      id: ARTICLES.archived.id,
      blogId: BLOG.id,
      authorId: AUTHORS.grace.id,
      categoryId: null,
      title: ARTICLES.archived.title,
      subtitle: null,
      slug: ARTICLES.archived.slug,
      excerpt: 'The original alpha announcement, kept for history.',
      content: [h2('Alpha'), paragraph('It was a different time.')],
      coverImage: cover(
        'calliope-alpha',
        'An old newspaper announcing the alpha',
      ),
      coverImageUrl: 'https://picsum.photos/seed/calliope-alpha/1600/900',
      featured: false,
      seriesId: null,
      seriesPosition: null,
      readingTimeMinutes: 1,
      canonicalUrl: null,
      locale: 'en',
      corrections: [],
      seo: { noIndex: true },
      status: 'ARCHIVED',
      publishedAt: daysAgo(90),
      createdAt: daysAgo(91),
      relatedArticleIds: [],
      tags: { connect: [{ id: TAGS.releaseNotes.id }] },
    },
  });

  const published = await prisma.article.count({
    where: { blogId: BLOG.id, status: PUBLISHED },
  });
  console.log(
    [
      'calliope seed: done.',
      `  blog:    ${BLOG.slug} (${BLOG.id})`,
      `  tenant:  ${DEV_TENANT}`,
      `  series:  ${SERIES.slug} (${SERIES.id})`,
      `  published: ${published} (2 in series, 1 featured, 1 with corrections)`,
      '  draft: 1, archived: 1 (public routes must filter both)',
    ].join('\n'),
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
