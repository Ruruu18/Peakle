import { useRef } from 'react';

// Returns functions that keep the same identity across renders but always call
// the latest handler passed in. Memoized list rows can take them as props
// without re-rendering every row whenever the parent renders.
export default function useStableHandlers(handlers) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const stable = useRef({});
  Object.keys(handlers).forEach((key) => {
    if (!stable.current[key]) stable.current[key] = (...args) => latest.current[key]?.(...args);
  });
  return stable.current;
}
