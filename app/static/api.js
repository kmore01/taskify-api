// api.js - Single HTTP client for the Taskify API.
// Adds the Bearer token, serializes the body, parses backend errors and,
// on a 401, clears the session and tells the app to return to login.

const TOKEN_KEY = "taskify_token";

// Error with a readable message and HTTP status.
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Session
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated() {
  return Boolean(getToken());
}

// Errors
// Backend `detail` is either { error } or a Pydantic list of { msg, loc }.
export function describeError(detail) {
  if (!detail) return "Ocurrió un error inesperado.";

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const loc = Array.isArray(item.loc)
          ? item.loc.filter((part) => part !== "body" && part !== "query").join(".")
          : "";
        return loc ? `${loc}: ${item.msg}` : item.msg;
      })
      .join("\n");
  }

  if (typeof detail === "object" && typeof detail.error === "string") {
    return detail.error;
  }

  return "Ocurrió un error inesperado.";
}

// Request
// `body` can be an object (serialized to JSON), URLSearchParams or FormData.
export async function apiFetch(path, options = {}) {
  const { method = "GET", body, headers = {}, ...rest } = options;
  const finalHeaders = { Accept: "application/json", ...headers };
  let finalBody = body;

  if (body instanceof URLSearchParams || body instanceof FormData) {
    // Let the browser set the correct Content-Type.
    finalBody = body;
  } else if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    finalBody = JSON.stringify(body);
  }

  const token = getToken();
  if (token) finalHeaders["Authorization"] = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(path, { method, headers: finalHeaders, body: finalBody, ...rest });
  } catch {
    throw new ApiError("No se pudo conectar con el servidor.", 0);
  }

  // Invalid or expired token: clear the client session.
  if (response.status === 401) {
    clearSession();
    window.dispatchEvent(new CustomEvent("taskify:unauthorized"));
  }

  if (response.status === 204) return null;

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    const detail = data && data.detail !== undefined ? data.detail : data;
    throw new ApiError(describeError(detail), response.status);
  }

  return data;
}
