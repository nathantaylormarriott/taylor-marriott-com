export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function encodeFormData(data) {
  return Object.keys(data)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
    .join('&');
}

function field(form, key) {
  return form.elements.namedItem(key);
}

export function getInvalidContactFields(form) {
  const invalid = [];
  const nameEl = field(form, 'name');
  const emailEl = field(form, 'email');
  const messageEl = field(form, 'message');
  if (!nameEl?.value.trim()) invalid.push('name');
  if (!emailEl?.value.trim() || !emailPattern.test(emailEl.value.trim())) invalid.push('email');
  if (!messageEl?.value.trim()) invalid.push('message');
  return invalid;
}

export function getContactFormData(form) {
  const companyEl = field(form, 'company');
  const phoneEl = field(form, 'phone');
  return {
    'form-name': 'contact',
    name: field(form, 'name').value.trim(),
    email: field(form, 'email').value.trim(),
    phone: phoneEl?.value.trim() ?? '',
    company: companyEl?.value.trim() ?? '',
    message: field(form, 'message').value.trim(),
  };
}

export async function submitContactForm(form) {
  const invalid = getInvalidContactFields(form);
  if (invalid.length) {
    return { ok: false, invalid };
  }

  const response = await fetch('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encodeFormData(getContactFormData(form)),
  });

  return { ok: response.ok };
}
