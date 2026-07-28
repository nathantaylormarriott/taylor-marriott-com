export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// TEMP: remove before launch — skip validation + submit for success-flow testing
export const TEMP_BYPASS_CONTACT_SUBMIT = true;

export function encodeFormData(data) {
  return Object.keys(data)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
    .join('&');
}

export function getInvalidContactFields(form) {
  const invalid = [];
  if (!form.name.value.trim()) invalid.push('name');
  if (!form.email.value.trim() || !emailPattern.test(form.email.value.trim())) invalid.push('email');
  if (!form.message.value.trim()) invalid.push('message');
  return invalid;
}

export function getContactFormData(form) {
  return {
    'form-name': 'contact',
    name: form.name.value.trim(),
    email: form.email.value.trim(),
    company: form.company.value.trim(),
    message: form.message.value.trim(),
  };
}

export async function submitContactForm(form) {
  if (TEMP_BYPASS_CONTACT_SUBMIT) {
    return { ok: true };
  }

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
