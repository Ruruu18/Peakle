// Native already has its own match lifecycle. Browser refresh recovery is kept
// in the platform file so retiring the beta does not affect the native app.
export default function useMatchDraft() {
  return { status: null, settle: async () => null };
}
