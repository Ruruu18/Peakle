import { Platform } from 'react-native';

// Android Chrome runs its own long-press gesture (text selection, context menu)
// and cancels the touch, so react-native-web's onLongPress timer never fires.
// The browser still dispatches `contextmenu` for that gesture (and for a desktop
// right-click), so on web we treat it as the long press. Handlers passed here
// must be safe to call twice, since the Pressable timer may also fire first.
export function webLongPress(onLongPress) {
  if (Platform.OS !== 'web' || !onLongPress) return null;
  return {
    onContextMenu: (event) => {
      event.preventDefault();
      event.stopPropagation();
      onLongPress(event);
    },
  };
}

// Tracks whether a finger is still on the screen, so a menu opened by a long
// press can keep following that same finger (slide to pick a reaction).
let touchesDown = 0;
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  const sync = (event) => { touchesDown = event.touches.length; };
  ['touchstart', 'touchend', 'touchcancel'].forEach((type) => window.addEventListener(type, sync, { capture: true, passive: true }));
}
export const isTouchHeld = () => touchesDown > 0;
