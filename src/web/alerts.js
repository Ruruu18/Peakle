let queue = [];
const listeners = new Set();
let nextId = 0;

export const subscribeAlerts = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getAlert = () => queue[0] || null;
const notify = () => listeners.forEach((listener) => listener());

export function showWebAlert(title, message, buttons, options) {
  queue = [...queue, {
    id: ++nextId, title, message, options,
    buttons: buttons?.length ? buttons : [{ text: 'OK' }],
  }];
  notify();
}

export function closeWebAlert(id, buttonIndex) {
  const current = getAlert();
  if (!current || current.id !== id) return;
  queue = queue.slice(1);
  notify();
  if (buttonIndex === undefined) current.options?.onDismiss?.();
  else current.buttons[buttonIndex]?.onPress?.();
}
