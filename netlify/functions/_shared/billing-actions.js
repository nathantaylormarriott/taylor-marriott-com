/**
 * Apply a pause or resume to a client site.
 * Dry-run builds the blob body and the Netlify PATCH and does not send them.
 * Live writes the pause blob on that site (no rebuild) and detaches or reattaches the domain.
 */
import { getStore } from '@netlify/blobs';
import { buildAttachDomainRequest } from './netlify-sites.js';

export function buildDetachDomainRequest(site) {
  return {
    method: 'PATCH',
    path: `/sites/${site.siteId}`,
    body: { custom_domain: null, domain_aliases: [] },
  };
}

export function buildPauseBlob({ paused, reason, at }) {
  return {
    paused: paused === true,
    reason: reason || null,
    at: at || new Date().toISOString(),
  };
}

export async function writeClientPauseSwitch({ siteId, record, token, storeFactory } = {}) {
  if (!siteId) {
    const err = new Error('netlify site id missing. Pause switch not written.');
    err.code = 'NO_SITE';
    throw err;
  }
  const factory = storeFactory || ((opts) => getStore({ ...opts, consistency: 'strong' }));
  const store = factory({ name: 'site-pause', siteID: siteId, token });
  await store.setJSON('status', record);
  return record;
}

async function runStep(dryRun, live, step) {
  if (dryRun || !live) return { ...step, mode: 'dry_run' };
  const result = await live();
  return { ...step, mode: 'live', result: result || null };
}

export async function applySiteChange({ account, decision, dryRun = true, deps = {} } = {}) {
  const steps = [];
  const site = {
    siteId: (account && (account.netlifySiteId || account.siteId)) || null,
    siteName: account && (account.netlifySiteName || account.siteName),
    domainAliases: (account && account.domainAliases) || [],
  };
  if (!decision) return { steps, applied: false };

  if (decision.pauseSite) {
    const blob = buildPauseBlob({ paused: true, reason: 'unpaid' });
    steps.push(
      await runStep(dryRun, deps.writePause && site.siteId ? () => deps.writePause({ siteId: site.siteId, record: blob }) : null, {
        id: 'pause_switch',
        blob,
        siteId: site.siteId,
      }),
    );
  }
  if (decision.detachDomain && site.siteId) {
    const request = buildDetachDomainRequest(site);
    steps.push(
      await runStep(dryRun, deps.netlifyApi ? () => deps.netlifyApi(request.path, { method: 'PATCH', body: request.body }) : null, {
        id: 'detach_domain',
        request,
      }),
    );
  }
  if (decision.renewAtRegistrar === false) {
    steps.push({ id: 'registrar_renew', mode: 'skipped', reason: 'unpaid_or_not_due' });
  }
  if (decision.reattachDomain && site.siteId && account && account.domain) {
    const request = buildAttachDomainRequest(site, account.domain);
    steps.push(
      await runStep(dryRun, deps.netlifyApi ? () => deps.netlifyApi(request.path, { method: 'PATCH', body: request.body }) : null, {
        id: 'reattach_domain',
        request,
      }),
    );
  }
  if (decision.reregister) {
    steps.push(
      await runStep(dryRun, deps.reregister ? () => deps.reregister(account) : null, {
        id: 'reregister',
        domain: account && account.domain,
      }),
    );
  }
  if (decision.clearPause) {
    const blob = buildPauseBlob({ paused: false, reason: 'paid' });
    steps.push(
      await runStep(dryRun, deps.writePause && site.siteId ? () => deps.writePause({ siteId: site.siteId, record: blob }) : null, {
        id: 'pause_switch',
        blob,
        siteId: site.siteId,
      }),
    );
  }
  if (decision.emailNathan) {
    steps.push({ id: 'email_nathan', mode: dryRun ? 'dry_run' : 'queued', reason: decision.reason || 'domain_not_restored' });
  }
  return { steps, applied: steps.some((step) => step.mode === 'live') };
}
