import {
  SKILL_CATEGORIES,
  skillCategory,
  skillCategoryForRange,
  skillCategoryForRating,
  skillRangeLabel,
} from '../skillCategories';

describe('skillCategory', () => {
  it('finds a category by value and falls back to Open level for unknown values', () => {
    expect(skillCategory('advanced').label).toBe('Advanced');
    expect(skillCategory('not-a-real-value')).toBe(SKILL_CATEGORIES[0]);
  });
});

describe('skillCategoryForRating', () => {
  it('places a rating into its matching band', () => {
    expect(skillCategoryForRating(1.5).value).toBe('novice');
    expect(skillCategoryForRating(3.0).value).toBe('intermediate');
    expect(skillCategoryForRating(5.0).value).toBe('advanced');
  });

  it('returns null for a non-numeric or unrated player', () => {
    expect(skillCategoryForRating(null)).toBeNull();
    expect(skillCategoryForRating(undefined)).toBeNull();
    expect(skillCategoryForRating('n/a')).toBeNull();
  });

  it('returns null just outside the covered range', () => {
    expect(skillCategoryForRating(0.5)).toBeNull();
    expect(skillCategoryForRating(6)).toBeNull();
  });
});

describe('skillCategoryForRange / skillRangeLabel', () => {
  it('matches an exact known band and labels it with its range', () => {
    expect(skillCategoryForRange(2.6, 3.9).value).toBe('intermediate');
    expect(skillRangeLabel(2.6, 3.9)).toBe('Intermediate · 2.6–3.9');
  });

  it('labels an unrestricted range as Open level without a range suffix', () => {
    expect(skillRangeLabel(null, null)).toBe('Open level');
  });

  it('falls back to a custom label for a non-standard range', () => {
    expect(skillRangeLabel(2.0, 3.0)).toBe('Custom · 2.0–3.0');
    expect(skillRangeLabel(null, 3.0)).toBe('Up to 3.0');
    expect(skillRangeLabel(2.0, null)).toBe('2.0 and above');
  });
});
