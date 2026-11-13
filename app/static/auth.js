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

// Swap a still-valid token for a fresh one so an active session never expires.
export async function refreshSession() {
  if (!isAuthenticated()) return;
  try {
    setToken((await apiFetch("/auth/refresh", { method: "POST" })).access_token);
  } catch {
    /* offline or expired: the next API call reports it */
  }
}

// The server rejects every older token, so keep the new one it returns.
export async function changePassword(currentPassword, newPassword) {
  const data = await apiFetch("/auth/password", {
    method: "POST",
    body: { current_password: currentPassword, new_password: newPassword },
  });
  setToken(data.access_token);
}

export async function deleteAccount(password) {
  await apiFetch("/auth/users/me", { method: "DELETE", body: { password } });
  clearSession();
}

export function forgotPassword(email) {
  return apiFetch("/auth/forgot", { method: "POST", body: { email } });
}

export function resetPassword(token, newPassword) {
  return apiFetch("/auth/reset", {
    method: "POST",
    body: { token, new_password: newPassword },
  });
}
