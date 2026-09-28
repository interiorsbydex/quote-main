const LOGIN_RETURN_PATH_KEY = "quote-builder.login-return-path";

function isSafeLocalPath(value: string | null): value is string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return false;
  }

  try {
    const destination = new URL(value, window.location.origin);
    return destination.origin === window.location.origin && destination.pathname !== "/login";
  } catch {
    return false;
  }
}

export function saveLoginReturnPath() {
  const destination = window.location.pathname + window.location.search + window.location.hash;
  if (!isSafeLocalPath(destination)) {
    return;
  }

  try {
    window.sessionStorage.setItem(LOGIN_RETURN_PATH_KEY, destination);
  } catch {
    // Authentication still works when browser storage is unavailable.
  }
}

export function consumeLoginReturnPath() {
  try {
    const destination = window.sessionStorage.getItem(LOGIN_RETURN_PATH_KEY);
    window.sessionStorage.removeItem(LOGIN_RETURN_PATH_KEY);
    return isSafeLocalPath(destination) ? destination : "/";
  } catch {
    return "/";
  }
}