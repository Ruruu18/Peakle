// Metro selects the browser implementation only for the removable web beta.
export async function exportWebMatchCard() {
  throw new Error('Use the native match card exporter on this device.');
}
