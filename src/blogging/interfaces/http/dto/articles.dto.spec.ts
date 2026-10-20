import { UpdateArticleDto, CreateArticleDto } from './articles.dto';
import { UpdateAuthorDto } from './authors.dto';
import { UpdateCategoryDto } from './categories.dto';
import { paginationQuerySchema, toPage } from '../../../application/pagination';

describe('Update DTOs — explicit null clears, absent keeps', () => {
  it('article PATCH accepts explicit null for every clearable field', () => {
    const result = UpdateArticleDto.schema.safeParse({
      categoryId: null,
      excerpt: null,
      coverImageUrl: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categoryId).toBeNull();
      expect(result.data.excerpt).toBeNull();
      expect(result.data.coverImageUrl).toBeNull();
    }
  });

  it('article PATCH keeps the absent/undefined distinction', () => {
    const result = UpdateArticleDto.schema.safeParse({ title: 'Only' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ title: 'Only' }); // no nulls injected
    }
  });

  it('article PATCH still validates types when a value is present', () => {
    expect(
      UpdateArticleDto.schema.safeParse({ categoryId: 'not-a-uuid' }).success,
    ).toBe(false);
    expect(UpdateArticleDto.schema.safeParse({ excerpt: 42 }).success).toBe(
      false,
    );
    expect(UpdateArticleDto.schema.safeParse({ version: -1 }).success).toBe(
      false,
    );
  });

  it('author PATCH accepts null bio/avatarUrl; category PATCH null description', () => {
    expect(
      UpdateAuthorDto.schema.safeParse({ bio: null, avatarUrl: null }).success,
    ).toBe(true);
    expect(
      UpdateCategoryDto.schema.safeParse({ description: null }).success,
    ).toBe(true);
  });

  it('tagIds is capped at 50', () => {
    const fifty = Array.from(
      { length: 50 },
      () => '123e4567-e89b-42d3-a456-426614174000',
    );
    expect(
      CreateArticleDto.schema.safeParse({
        title: 'T',
        content: [{ type: 'p', data: {} }],
        authorId: '123e4567-e89b-42d3-a456-426614174000',
        tagIds: fifty,
      }).success,
    ).toBe(true);
    expect(
      CreateArticleDto.schema.safeParse({
        title: 'T',
        content: [{ type: 'p', data: {} }],
        authorId: '123e4567-e89b-42d3-a456-426614174000',
        tagIds: [...fifty, ...fifty],
      }).success,
    ).toBe(false);
  });

  it('create accepts an optional client-supplied id (idempotency primitive)', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    const ok = CreateArticleDto.schema.safeParse({
      id,
      title: 'T',
      content: [{ type: 'p', data: {} }],
      authorId: id,
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.id).toBe(id);
    }
    expect(
      CreateArticleDto.schema.safeParse({
        id: 'nope',
        title: 'T',
        content: [{ type: 'p', data: {} }],
        authorId: id,
      }).success,
    ).toBe(false);
  });
});

describe('pagination caps', () => {
  it('page is capped at 10_000', () => {
    expect(paginationQuerySchema.safeParse({ page: '10001' }).success).toBe(
      false,
    );
    expect(paginationQuerySchema.safeParse({ page: '10000' }).success).toBe(
      true,
    );
  });

  it('pageSize stays capped at 100', () => {
    expect(paginationQuerySchema.safeParse({ pageSize: '101' }).success).toBe(
      false,
    );
  });

  it('toPage derives skip/take from the coerced query', () => {
    const page = toPage(
      paginationQuerySchema.parse({ page: '3', pageSize: '10' }),
    );
    expect(page).toEqual({ skip: 20, take: 10, page: 3, pageSize: 10 });
  });
});
