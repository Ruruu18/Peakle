export const SKILL_CATEGORIES = Object.freeze([
  Object.freeze({ value: 'open', label: 'Open level', min: null, max: null, rangeLabel: 'Any rating' }),
  Object.freeze({ value: 'novice', label: 'Novice', min: 1, max: 2.5, rangeLabel: '1.0–2.5' }),
  Object.freeze({ value: 'intermediate', label: 'Intermediate', min: 2.6, max: 3.9, rangeLabel: '2.6–3.9' }),
  Object.freeze({ value: 'advanced', label: 'Advanced', min: 4, max: 5.5, rangeLabel: '4.0–5.5' }),
]);

export const TEAM_SKILL_LEVELS = Object.freeze(SKILL_CATEGORIES.map((category) => category.label));

export function skillCategory(value) {
  return SKILL_CATEGORIES.find((category) => category.value === value) || SKILL_CATEGORIES[0];
}

export function skillCategoryForRange(minimum, maximum) {
  if (minimum == null && maximum == null) return SKILL_CATEGORIES[0];
  return SKILL_CATEGORIES.find((category) => category.min === Number(minimum) && category.max === Number(maximum)) || null;
}

export function skillCategoryForRating(rating) {
  const numeric = Number(rating);
  if (!Number.isFinite(numeric)) return null;
  return SKILL_CATEGORIES.find((category) => category.min != null && numeric >= category.min && numeric <= category.max) || null;
}

export function skillRangeLabel(minimum, maximum) {
  const category = skillCategoryForRange(minimum, maximum);
  if (category) return category.value === 'open' ? category.label : `${category.label} · ${category.rangeLabel}`;
  if (minimum == null) return `Up to ${Number(maximum).toFixed(1)}`;
  if (maximum == null) return `${Number(minimum).toFixed(1)} and above`;
  return `Custom · ${Number(minimum).toFixed(1)}–${Number(maximum).toFixed(1)}`;
}
