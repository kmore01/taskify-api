// auth.js - Registro, inicio de sesión y verificación de sesión.

import { apiFetch, clearSession, getToken, isAuthenticated, setToken } from "./api.js";

// Crea una cuenta. El backend espera JSON: { username, email, password }.
export async function register({ username, email, password }) {
  return apiFetch("/auth/register", {
    method: "POST",
    body: { username, email, password },
  });
}

// Inicia sesión. /auth/login espera form-urlencoded (OAuth2PasswordRequestForm),
// no JSON. Guarda el token devuelto para el resto de peticiones.
export async function login(username, password) {
  const form = new URLSearchParams();
  form.set("username", username);
  form.set("password", password);

  const data = await apiFetch("/auth/login", { method: "POST", body: form });
  setToken(data.access_token);
  return data;
}

// Devuelve el usuario actual a partir del token guardado.
export async function me() {
  return apiFetch("/auth/users/me");
}

// Cierra la sesión en el cliente.
export function logout() {
  clearSession();
}

export { getToken, isAuthenticated };
