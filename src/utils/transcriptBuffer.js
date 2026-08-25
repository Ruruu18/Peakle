function cleanFragment(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function comparableWords(value) {
  return cleanFragment(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * Joins consecutive recognition fragments without repeating the overlapping words.
 * Speech engines commonly emit "point team" followed by either "team one" or
 * "point team one" after restarting a short recognition session.
 */
export function mergeTranscriptFragments(previousValue, nextValue) {
  const previous = cleanFragment(previousValue);
  const next = cleanFragment(nextValue);
  if (!previous) return next;
  if (!next) return previous;

  const previousWords = previous.split(' ');
  const nextWords = next.split(' ');
  const previousComparable = comparableWords(previous);
  const nextComparable = comparableWords(next);

  if (nextComparable.join(' ') === previousComparable.join(' ')) {
    return next.length >= previous.length ? next : previous;
  }

  if (nextComparable.length >= previousComparable.length
    && previousComparable.every((word, index) => nextComparable[index] === word)) {
    return next;
  }

  if (previousComparable.length >= nextComparable.length
    && nextComparable.every((word, index) => previousComparable[index] === word)) {
    return previous;
  }

  const maxOverlap = Math.min(previousComparable.length, nextComparable.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const previousTail = previousComparable.slice(-overlap);
    const nextHead = nextComparable.slice(0, overlap);
    if (previousTail.every((word, index) => word === nextHead[index])) {
      return [...previousWords, ...nextWords.slice(overlap)].join(' ');
    }
  }

  return `${previous} ${next}`;
}

export function moreCompleteTranscript(currentValue, candidateValue) {
  const current = cleanFragment(currentValue);
  const candidate = cleanFragment(candidateValue);
  if (!current) return candidate;
  if (!candidate) return current;

  const currentWords = comparableWords(current).length;
  const candidateWords = comparableWords(candidate).length;
  if (candidateWords !== currentWords) return candidateWords > currentWords ? candidate : current;
  return candidate.length > current.length ? candidate : current;
}
