// auth.js - Registration, login and session check.

import { apiFetch, clearSession, getToken, isAuthenticated, setToken } from "./api.js";

// Register: JSON body { username, email, password }.
export async function register({ username, email, password }) {
  return apiFetch("/auth/register", {
    method: "POST",
    body: { username, email, password },
  });
}

// /auth/login expects form-urlencoded (OAuth2PasswordRequestForm), not JSON.
// Stores the returned token for later requests.
export async function login(username, password) {
  const form = new URLSearchParams();
  form.set("username", username);
  form.set("password", password);

  const data = await apiFetch("/auth/login", { method: "POST", body: form });
  setToken(data.access_token);
  return data;
}

// Current user from the stored token.
export async function me() {
  return apiFetch("/auth/users/me");
}

// Clear the session client-side.
export function logout() {
  clearSession();
}

export { getToken, isAuthenticated };
