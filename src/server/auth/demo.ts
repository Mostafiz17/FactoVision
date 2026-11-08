/** Demo access is opt-in and is always disabled in production. */
export function demoEnabled(env = process.env): boolean {
  return env.NODE_ENV !== "production" && env.ENABLE_DEMO === "true";
}

export function isDemoAccount(email: string): boolean {
  return /^(ava|noah|mira|leo|zoe)@cadence\.dev$/i.test(email);
}
