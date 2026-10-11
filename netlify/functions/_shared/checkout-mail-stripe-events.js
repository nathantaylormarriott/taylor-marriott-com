/** Shared invoice metadata parsing (mirrors domain-renew.js). */
export function subscriptionMetadataFromInvoiceHelper(invoice) {
  const fromSub =
    (invoice.subscription_details && invoice.subscription_details.metadata) ||
    (invoice.parent &&
      invoice.parent.subscription_details &&
      invoice.parent.subscription_details.metadata) ||
    null;
  if (fromSub && Object.keys(fromSub).length) return fromSub;
  return invoice.metadata || {};
}
