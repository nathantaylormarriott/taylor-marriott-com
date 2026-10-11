/**
 * place_id -> Netlify site for client preview sites.
 *
 * The checkout only knows the place_id from the preview's "Make it Yours"
 * link. Add one entry per built site (the bulk-websites box can append this
 * after each deploy). Sites missing here are found by scanning the team's
 * tmbulk-* sites for a checkout link with this exact place_id.
 */
export const CLIENT_SITES = Object.freeze({
  'cid-5705786826933327223': {
    siteId: 'f71d8d6d-79b1-44c7-9531-6f926bca9b3c',
    siteName: 'tmbulk-s-and-r-construction-atherstone',
    business: 'S&R Construction, Atherstone',
  },
});
