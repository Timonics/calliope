/**
 * Volume seed — 30 EXTRA articles in the EXISTING `main` dev blog
 * (`22222222-…`), on top of the 5 deterministic fixtures from seed.ts.
 * The point is realistic listing volume: pagination, filters, tag
 * threads, a second series.
 *
 *   * 26 published, 2 drafts, 2 archived;
 *   * NO new featured article — the contract (and the frontend build)
 *     expects exactly one featured post (the release notes), so every
 *     article here is `featured: false`;
 *   * a new 3-part series `calliope-internals`, separate from
 *     `shipping-calliope` (whose parts 1+2 stay untouched);
 *   * reuses the blog's existing authors / categories / tags — this
 *     script must run AFTER `npm run db:seed`;
 *   * `publishedAt` spread over the last year, OLDER than the fixtures
 *     so the deterministic articles keep the top of the listing;
 *   * deterministic ids (`50000000-…-<i>`): re-running deletes exactly
 *     the 30 volume articles and re-inserts them. The 5 fixtures are
 *     never touched.
 *
 * NEVER point this at a database you care about.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BLOG_ID = '22222222-2222-4222-8222-222222222222';

const uuid = (i: number): string =>
  `50000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

const VOLUME_IDS = Array.from({ length: 30 }, (_, i) => uuid(i + 1));

const SERIES = {
  id: 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',
  name: 'Calliope Internals',
  slug: 'calliope-internals',
};

const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);

const cover = (seed: string, alt: string) => ({
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

// title, slug, category slug, author key, tag slugs, reading time
type Spec = [string, string, string, 'ada' | 'grace', string[], number];

const ARTICLES: Spec[] = [
  [
    'Calliope Internals, Part 1: The Repository Boundary',
    'calliope-internals-part-1-repository-boundary',
    'engineering',
    'ada',
    ['api-design'],
    6,
  ],
  [
    'Calliope Internals, Part 2: Projecting the Public JSON',
    'calliope-internals-part-2-projecting-the-public-json',
    'engineering',
    'ada',
    ['api-design'],
    7,
  ],
  [
    'Calliope Internals, Part 3: Error Codes End to End',
    'calliope-internals-part-3-error-codes-end-to-end',
    'engineering',
    'grace',
    ['api-design'],
    5,
  ],
  [
    'Idempotency Keys in Practice',
    'idempotency-keys-in-practice',
    'engineering',
    'ada',
    ['api-design'],
    6,
  ],
  [
    'Optimistic Locking Without Tears',
    'optimistic-locking-without-tears',
    'engineering',
    'grace',
    ['api-design'],
    4,
  ],
  [
    'Postgres Arrays for Related Articles',
    'postgres-arrays-for-related-articles',
    'engineering',
    'grace',
    ['postgres', 'api-design'],
    5,
  ],
  [
    'Why Slugs Are Unique Per Blog',
    'why-slugs-are-unique-per-blog',
    'engineering',
    'ada',
    ['api-design'],
    3,
  ],
  [
    'Designing the List Envelope',
    'designing-the-list-envelope',
    'engineering',
    'ada',
    ['api-design'],
    4,
  ],
  [
    'Tenancy Checks at the Boundary',
    'tenancy-checks-at-the-boundary',
    'engineering',
    'grace',
    ['api-design'],
    5,
  ],
  [
    'Migrating Without Downtime',
    'migrating-without-downtime',
    'engineering',
    'grace',
    ['postgres'],
    7,
  ],
  [
    'The Case for Application-Minted UUIDs',
    'the-case-for-application-minted-uuids',
    'engineering',
    'ada',
    ['postgres'],
    4,
  ],
  [
    'Reading the Query Planner on Hot Paths',
    'reading-the-query-planner-on-hot-paths',
    'engineering',
    'grace',
    ['postgres'],
    8,
  ],
  [
    'Partial Indexes on Status',
    'partial-indexes-on-status',
    'engineering',
    'grace',
    ['postgres'],
    4,
  ],
  [
    'JSON Columns: Discipline Required',
    'json-columns-discipline-required',
    'engineering',
    'ada',
    ['postgres', 'api-design'],
    6,
  ],
  [
    'A Year of Release Notes',
    'a-year-of-release-notes',
    'product',
    'grace',
    ['release-notes'],
    5,
  ],
  [
    'Changelog-Driven Development',
    'changelog-driven-development',
    'product',
    'ada',
    ['release-notes'],
    4,
  ],
  [
    'What Goes in a Minor Version',
    'what-goes-in-a-minor-version',
    'product',
    'grace',
    ['release-notes'],
    4,
  ],
  [
    'Deprecating a Field Gently',
    'deprecating-a-field-gently',
    'product',
    'ada',
    ['api-design', 'release-notes'],
    5,
  ],
  [
    'Drafts, Archives and the Public Surface',
    'drafts-archives-and-the-public-surface',
    'engineering',
    'ada',
    ['api-design'],
    5,
  ],
  [
    'Corrections as a First-Class Field',
    'corrections-as-a-first-class-field',
    'product',
    'grace',
    ['release-notes'],
    3,
  ],
  [
    'Cover Images: Alt Text Is Not Optional',
    'cover-images-alt-text-is-not-optional',
    'product',
    'ada',
    [],
    4,
  ],
  [
    'Series: Counting Published Only',
    'series-counting-published-only',
    'engineering',
    'grace',
    ['api-design'],
    4,
  ],
  [
    'Cursor vs Offset Pagination',
    'cursor-vs-offset-pagination',
    'engineering',
    'ada',
    ['api-design', 'postgres'],
    7,
  ],
  [
    'Full-Text Search on a Budget',
    'full-text-search-on-a-budget',
    'engineering',
    'grace',
    ['postgres'],
    6,
  ],
  [
    'Rate Limiting the Management API',
    'rate-limiting-the-management-api',
    'engineering',
    'grace',
    ['api-design'],
    5,
  ],
  [
    'Observing the Blog Boundary',
    'observing-the-blog-boundary',
    'engineering',
    'ada',
    ['postgres'],
    5,
  ],
];

// Status overrides by article index; everything else is PUBLISHED.
// Drafts/archived are the LAST four so the top of the listing is clean.
const DRAFTS = new Set([26, 27]);
const ARCHIVED = new Set([28, 29]);

async function main(): Promise<void> {
  const blog = await prisma.blog.findUnique({
    where: { id: BLOG_ID },
    include: {
      authors: true,
      categories: true,
      tags: true,
      series: true,
    },
  });
  if (blog === null) {
    throw new Error(`blog ${BLOG_ID} not found — run "npm run db:seed" first`);
  }

  const author = (name: string): { id: string } => {
    const found = blog.authors.find((a) =>
      a.name.toLowerCase().startsWith(name),
    );
    if (found === undefined) throw new Error(`author ${name} missing`);
    return found;
  };
  const category = (slug: string): { id: string } => {
    const found = blog.categories.find((c) => c.slug === slug);
    if (found === undefined) throw new Error(`category ${slug} missing`);
    return found;
  };
  const tag = (slug: string): { id: string } => {
    const found = blog.tags.find((t) => t.slug === slug);
    if (found === undefined) throw new Error(`tag ${slug} missing`);
    return found;
  };

  // Re-runnable: remove exactly our 30 articles (the fixtures are
  // outside this id range) and our series row.
  await prisma.article.deleteMany({ where: { id: { in: VOLUME_IDS } } });
  await prisma.series.deleteMany({ where: { id: SERIES.id } });

  await prisma.series.create({
    data: { ...SERIES, blogId: BLOG_ID },
  });

  for (let i = 0; i < 30; i++) {
    const [title, slug, catSlug, authorName, tagSlugs, mins] =
      ARTICLES[i % ARTICLES.length];
    // Indexes 26-29 reuse topics 0-3 with a suffix so slugs stay unique.
    const suffix =
      i >= ARTICLES.length ? `-${Math.floor(i / ARTICLES.length) + 1}` : '';
    const status = DRAFTS.has(i)
      ? 'DRAFT'
      : ARCHIVED.has(i)
        ? 'ARCHIVED'
        : 'PUBLISHED';
    const publishedAt = status === 'PUBLISHED' ? daysAgo(30 + i * 11) : null; // all older than the fixtures

    const seriesId = i < 3 ? SERIES.id : null;

    await prisma.article.create({
      data: {
        id: uuid(i + 1),
        blogId: BLOG_ID,
        authorId: author(authorName === 'ada' ? 'ada' : 'grace').id,
        categoryId: category(catSlug).id,
        title: i >= ARTICLES.length ? `${title} (Revisited)` : title,
        subtitle: null,
        slug: `${slug}${suffix}`,
        excerpt: `${title} — notes from the calliope codebase.`,
        content: [
          h2('Why this matters'),
          paragraph(
            'A longer body would live here in production; this seed keeps blocks short so listing payloads stay readable.',
          ),
          paragraph(`Working notes for “${title}”.`),
        ],
        coverImage: cover(`calliope-${slug}`, `Cover for ${title}`),
        coverImageUrl: `https://picsum.photos/seed/calliope-${slug}/1600/900`,
        featured: false, // the release notes stay the single featured hero
        seriesId,
        seriesPosition: seriesId ? i + 1 : null,
        readingTimeMinutes: mins,
        canonicalUrl: null,
        locale: 'en',
        corrections: [],
        seo: {},
        status,
        publishedAt,
        relatedArticleIds: [],
        tags: { connect: tagSlugs.map((s) => ({ id: tag(s).id })) },
      },
    });
  }

  const published = await prisma.article.count({
    where: { blogId: BLOG_ID, status: 'PUBLISHED' },
  });
  const featured = await prisma.article.count({
    where: { blogId: BLOG_ID, status: 'PUBLISHED', featured: true },
  });
  console.log(
    [
      'volume seed: done.',
      `  blog:      main (${BLOG_ID})`,
      `  added:     30 volume articles (26 published, 2 drafts, 2 archived)`,
      `  blog now:  ${await prisma.article.count({ where: { blogId: BLOG_ID } })} articles total, ${published} published`,
      `  series:    ${SERIES.slug} (3 parts; shipping-calliope untouched)`,
      `  featured:  ${featured} (still exactly one — the release notes)`,
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
