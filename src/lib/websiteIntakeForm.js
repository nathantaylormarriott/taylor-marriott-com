import { emailPattern, encodeFormData as encodeFlatFormData } from './contactForm';

export const FORM_NAME = 'website-intake';

const urlPattern = /^https?:\/\/.+/i;

function field(form, key) {
  return form.elements.namedItem(key);
}

function getSocialUrls(form) {
  const nodes = form.querySelectorAll('input[name="social_url"]');
  return Array.from(nodes)
    .map((el) => el.value.trim())
    .filter(Boolean);
}

export function getInvalidWebsiteIntakeFields(form) {
  const invalid = [];
  const nameEl = field(form, 'name');
  const phoneEl = field(form, 'phone');
  const businessEl = field(form, 'business_name');
  const emailEl = field(form, 'email');
  const gbpEl = field(form, 'gbp_url');

  if (!nameEl?.value.trim()) invalid.push('name');
  if (!phoneEl?.value.trim()) invalid.push('phone');
  if (!businessEl?.value.trim()) invalid.push('business_name');

  const emailVal = emailEl?.value.trim() ?? '';
  if (emailVal && !emailPattern.test(emailVal)) invalid.push('email');

  const gbpVal = gbpEl?.value.trim() ?? '';
  if (gbpVal && !urlPattern.test(gbpVal)) invalid.push('gbp_url');

  getSocialUrls(form).forEach((url, index) => {
    if (url && !urlPattern.test(url)) invalid.push(`social_url_${index}`);
  });

  return invalid;
}

export function getWebsiteIntakeFormData(form) {
  const emailEl = field(form, 'email');
  const aboutEl = field(form, 'about');
  const gbpEl = field(form, 'gbp_url');
  const sourceEl = field(form, 'source_path');
  const submittedEl = field(form, 'submitted_at');

  return {
    'form-name': FORM_NAME,
    name: field(form, 'name').value.trim(),
    phone: field(form, 'phone').value.trim(),
    business_name: field(form, 'business_name').value.trim(),
    email: emailEl?.value.trim() ?? '',
    about: aboutEl?.value.trim() ?? '',
    gbp_url: gbpEl?.value.trim() ?? '',
    social_urls: getSocialUrls(form),
    source_path: sourceEl?.value.trim() ?? '',
    submitted_at: submittedEl?.value.trim() ?? '',
  };
}

function encodeFormData(data) {
  const parts = [];
  Object.entries(data).forEach(([key, value]) => {
    if (key === 'social_urls') {
      (value || []).forEach((url) => {
        parts.push(`${encodeURIComponent('social_url')}=${encodeURIComponent(url)}`);
      });
      return;
    }
    if (value != null && value !== '') {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  });
  return parts.join('&');
}

export async function submitWebsiteIntakeForm(form) {
  const invalid = getInvalidWebsiteIntakeFields(form);
  if (invalid.length) {
    return { ok: false, invalid };
  }

  const data = getWebsiteIntakeFormData(form);
  data.submitted_at = new Date().toISOString();

  const response = await fetch('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encodeFormData(data),
  });

  return { ok: response.ok };
}

/** @deprecated use encodeFormData in this module for intake payloads */
export { encodeFlatFormData };
