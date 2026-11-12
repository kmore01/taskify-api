import { apiFetch, clearSession, getToken, isAuthenticated, setToken } from "./api.js";

export async function register({ username, email, password }) {
  return apiFetch("/auth/register", {
    method: "POST",
    body: { username, email, password },
  });
}

// /auth/login expects form-urlencoded (OAuth2PasswordRequestForm), not JSON.
export async function login(username, password) {
  const form = new URLSearchParams();
  form.set("username", username);
  form.set("password", password);

  const data = await apiFetch("/auth/login", { method: "POST", body: form });
  setToken(data.access_token);
  return data;
}

export async function me() {
  return apiFetch("/auth/users/me");
}

export function logout() {
  clearSession();
}

export { getToken, isAuthenticated };
