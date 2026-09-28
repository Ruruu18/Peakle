// React Navigation (bottom-tabs and elements, still as of 7.19 / 2.9.43) passes
// `pointerEvents` as a View prop, which react-native-web flags on every tab render.
// Our own code uses style.pointerEvents; hide only this library warning in development.
if (__DEV__ && typeof window !== 'undefined') {
  const warn = console.warn;
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('props.pointerEvents is deprecated')) return;
    warn(...args);
  };
}
