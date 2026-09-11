export const SAM_ACCOUNT_URL = "https://sam.gov/workspace/profile/account-details";
export const SAM_KEY_REMINDER =
  "SAM.gov is not working. Create a new public API key and update SAM_API_KEY.";

export const SAM_RATE_LIMIT =
  "SAM.gov asked us to slow down. Wait a few minutes, then pull again.";

export class SamKeyError extends Error {
  samKeyInvalid = true as const;

  constructor(message = SAM_KEY_REMINDER) {
    super(message);
    this.name = "SamKeyError";
  }
}

export function isSamKeyError(error: unknown) {
  return error instanceof SamKeyError || (error instanceof Error && error.name === "SamKeyError");
}
