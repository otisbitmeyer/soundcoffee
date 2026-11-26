// Calls to the Worker's admin routes. The first call signs a short message
// with the Sound Coffee key and trades it for a session token (kept in this
// tab's sessionStorage for 8 hours); every later call just sends the token.
// The token only ever goes to this site's own /api/ routes.

const STORAGE_KEY = "sc-admin-session";
let signer = null;
let inflight = null;

/** Called by AuthContext so this module can sign with whichever login is active. */
export function setAdminSigner(fn) {
  signer = fn;
}

function readToken() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { token, expires } = JSON.parse(raw);
    return token && Date.now() < expires ? token : null;
  } catch {
    return null;
  }
}

function clearToken() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function signIn() {
  if (!signer) throw new Error("Log in as the Sound Coffee account first.");
  if (!inflight) {
    inflight = (async () => {
      const event = await signer({
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["u", `${window.location.origin}/api/admin/session`],
          ["method", "POST"],
        ],
        content: "",
      });
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Admin sign-in failed.");
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ token: data.token, expires: Date.now() + (data.expiresIn - 60) * 1000 })
        );
      } catch {
        // storage blocked: the token still works for this call
      }
      return data.token;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Same as fetch(), for a same-site /api/ admin route. Signs in first if needed. */
export async function adminFetch(url, init = {}) {
  const send = (token) =>
    fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  let res = await send(readToken() || (await signIn()));
  if (res.status === 401) {
    clearToken();
    res = await send(await signIn());
  }
  return res;
}
