import { loadCheckoutConfig } from './checkout-config.js';
import { attachLiveFxToCheckoutConfig } from './usd-to-gbp-fx.js';

export async function loadCheckoutConfigWithFx(opts = {}) {
  const base = loadCheckoutConfig(opts);
  return attachLiveFxToCheckoutConfig(base, opts);
}
