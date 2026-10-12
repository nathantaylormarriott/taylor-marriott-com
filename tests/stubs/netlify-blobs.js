/** Minimal stub so esbuild-bundled function handlers can import in tests. */
export function getStore() {
  return {
    async get() {
      return null;
    },
    async setJSON() {},
  };
}
