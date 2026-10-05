export const BOOTSTRAP_METADATA_KEY = "template_first_admin_bootstrap";

export function bootstrapMarker(input, status = "pending") {
  return {
    version: 1,
    status,
    loginName: input.loginName,
    displayName: input.displayName,
    email: input.email.toLowerCase()
  };
}

export function matchesBootstrapMarker(user, input) {
  const marker = user?.app_metadata?.[BOOTSTRAP_METADATA_KEY];
  return user?.email?.toLowerCase() === input.email.toLowerCase()
    && marker?.version === 1
    && ["pending", "complete"].includes(marker.status)
    && marker.loginName === input.loginName
    && marker.displayName === input.displayName
    && marker.email === input.email.toLowerCase();
}

export function isEmailConflict(user, input) {
  return Boolean(user)
    && user.email?.toLowerCase() === input.email.toLowerCase()
    && !matchesBootstrapMarker(user, input);
}
