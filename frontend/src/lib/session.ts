// Session token: in memory plus localStorage (key "af_token"). Subscribable for React.
const KEY = "af_token";
let token: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    token = window.localStorage.getItem(KEY);
  } catch {
    token = null;
  }
}

export function getToken(): string | null {
  load();
  return token;
}

export function setToken(t: string | null) {
  load();
  token = t;
  try {
    if (t) window.localStorage.setItem(KEY, t);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: memory only */
  }
  listeners.forEach((l) => l());
}

export function subscribeToken(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
