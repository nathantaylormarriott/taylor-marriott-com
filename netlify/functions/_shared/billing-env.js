/** Prefer Netlify.env.get inside functions. Fall back to process.env for unit tests. */
export function readEnv(name, env = process.env) {
  try {
    if (typeof Netlify !== 'undefined' && Netlify.env && typeof Netlify.env.get === 'function') {
      const value = Netlify.env.get(name);
      if (value != null && value !== '') return value;
    }
  } catch {
    /* unit tests have no Netlify global */
  }
  const fromProcess = env && env[name];
  return fromProcess == null || fromProcess === '' ? undefined : fromProcess;
}

export function envFlag(name, env = process.env) {
  return readEnv(name, env) === '1';
}
