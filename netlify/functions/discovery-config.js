import { getPublicDiscoveryConfig } from './_shared/discoverySettings.js';
import { handleOptions, jsonResponse } from './_shared/http.js';

export default async (request) => {
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'GET') {
    return jsonResponse(request, { error: 'Method not allowed' }, 405);
  }

  return jsonResponse(request, getPublicDiscoveryConfig());
};

export const config = {
  path: '/api/discovery/config',
};
