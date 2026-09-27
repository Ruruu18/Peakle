// Small fills for older phone browsers (Safari before iOS 15.4, older Android
// Chrome and in-app browsers). Loaded before anything else on web; each one is
// only added when the browser lacks it.

const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;

// expo-crypto's randomUUID on web calls crypto.randomUUID directly, which
// older browsers (and pages not served over HTTPS) do not have.
if (cryptoApi?.getRandomValues && typeof cryptoApi.randomUUID !== 'function') {
  cryptoApi.randomUUID = function randomUUID() {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

if (typeof Object.hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', {
    value: (object, key) => Object.prototype.hasOwnProperty.call(object, key),
    configurable: true,
    writable: true,
  });
}

function defineMethod(prototype, name, value) {
  if (typeof prototype[name] === 'function') return;
  Object.defineProperty(prototype, name, { value, configurable: true, writable: true });
}

defineMethod(Array.prototype, 'at', function at(index) {
  const position = Math.trunc(index) || 0;
  const resolved = position < 0 ? this.length + position : position;
  return resolved >= 0 && resolved < this.length ? this[resolved] : undefined;
});
defineMethod(String.prototype, 'at', function at(index) {
  return Array.prototype.at.call(String(this), index);
});
defineMethod(Array.prototype, 'findLast', function findLast(predicate, thisArg) {
  for (let index = this.length - 1; index >= 0; index -= 1) {
    if (predicate.call(thisArg, this[index], index, this)) return this[index];
  }
  return undefined;
});
defineMethod(Array.prototype, 'findLastIndex', function findLastIndex(predicate, thisArg) {
  for (let index = this.length - 1; index >= 0; index -= 1) {
    if (predicate.call(thisArg, this[index], index, this)) return index;
  }
  return -1;
});
