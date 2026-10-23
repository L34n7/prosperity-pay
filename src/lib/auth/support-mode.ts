export const SUPPORT_MODE_COOKIE = "prosperity_support_mode";
export const SUPPORT_AUTH_COOKIE = "prosperity-support-auth";
export const SUPPORT_SESSION_SECONDS = 30 * 60;

export function isSupportModeValue(value: string | undefined | null) {
  return value === "1";
}
