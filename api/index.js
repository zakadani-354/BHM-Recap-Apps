"use strict";

const crypto = require("node:crypto");

const COOKIE_NAME = "bhm-session";
const SESSION_DURATION_SECONDS = 60 * 60 * 8;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  res.end(JSON.stringify(body));
}

function getConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new ApiError(
      503,
      "CONFIG_REQUIRED",
      "Sinkronisasi belum dikonfigurasi. Admin perlu mengatur URL Supabase dan service role key pada hosting."
    );
  }
  return {
    url: url.replace(/\/+$/, ""),
    serviceKey,
    sessionSecret: process.env.BHM_SESSION_SECRET || serviceKey
  };
}

async function supabaseRequest(config, path, options = {}) {
  let response;
  try {
    response = await fetch(`${config.url}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  } catch (error) {
    console.error("Supabase request could not reach the configured service.", error);
    throw new ApiError(502, "DATABASE_UNAVAILABLE", "Database bersama tidak dapat dihubungi.");
  }
  const responseText = await response.text();
  if (!response.ok) {
    let diagnostic = {};
    try {
      const responseBody = JSON.parse(responseText);
      diagnostic = {
        code: typeof responseBody.code === "string" ? responseBody.code.slice(0, 80) : undefined,
        message: typeof responseBody.message === "string" ? responseBody.message.slice(0, 400) : undefined,
        hint: typeof responseBody.hint === "string" ? responseBody.hint.slice(0, 400) : undefined
      };
    } catch {
      diagnostic = { response: "Non-JSON error response" };
    }
    console.error("Supabase request failed.", {
      status: response.status,
      path,
      ...diagnostic
    });
    const missingDatabaseObject = ["PGRST202", "PGRST205", "42883", "42P01"]
      .includes(diagnostic.code);
    const authorizationFailure = [401, 403].includes(response.status)
      || diagnostic.code === "42501";
    let message = `Supabase menolak permintaan (HTTP ${response.status}`
      + `${diagnostic.code ? `, ${diagnostic.code}` : ""}). Periksa log Function di Vercel.`;
    if (missingDatabaseObject) {
      message = "Fungsi atau tabel Supabase belum ditemukan. Jalankan ulang supabase/schema.sql di SQL Editor, lalu coba lagi.";
    } else if (authorizationFailure) {
      message = "Supabase menolak akses server. Periksa SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di Vercel, lalu redeploy.";
    }
    throw new ApiError(
      502,
      "DATABASE_ERROR",
      message
    );
  }
  if (!responseText) return null;
  try {
    return JSON.parse(responseText);
  } catch (error) {
    console.error(`Supabase returned invalid JSON at ${path}.`, error);
    throw new ApiError(502, "DATABASE_RESPONSE_INVALID", "Respons database bersama tidak valid.");
  }
}

function signSession(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifySession(token, secret) {
  if (!token) return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest();
  let supplied;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!["admin", "pengurus"].includes(payload.role)
        || !["admin", "pengurus"].includes(payload.username)
        || !Number.isInteger(payload.exp)
        || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieValue(req, name) {
  const header = req.headers.cookie || "";
  const cookie = header.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : "";
}

function sessionCookie(req, token, maxAge) {
  const secure = process.env.NODE_ENV === "production"
    || req.headers["x-forwarded-proto"] === "https";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Format permintaan tidak valid.");
    }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new ApiError(413, "BODY_TOO_LARGE", "Ukuran data melebihi batas 4 MB.");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Format permintaan tidak valid.");
  }
}

function ensureSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new ApiError(403, "INVALID_ORIGIN", "Asal permintaan tidak diizinkan.");
  }
  if (parsedOrigin.host !== req.headers.host) {
    throw new ApiError(403, "INVALID_ORIGIN", "Asal permintaan tidak diizinkan.");
  }
}

async function authenticate(config, username, password) {
  const result = await supabaseRequest(config, "rpc/bhm_authenticate_app_user", {
    method: "POST",
    body: JSON.stringify({
      p_username: username,
      p_password: password
    })
  });
  const role = typeof result === "string" ? result : result?.role;
  return ["admin", "pengurus"].includes(role) ? role : null;
}

async function loadSharedState(config) {
  const rows = await supabaseRequest(
    config,
    "bhm_app_state?id=eq.shared&select=members,attendance,revision"
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    initialized: Boolean(row),
    members: Array.isArray(row?.members) ? row.members : [],
    attendance: Array.isArray(row?.attendance) ? row.attendance : [],
    revision: Number(row?.revision || 0)
  };
}

async function saveCollection(config, collection, data) {
  const revision = await supabaseRequest(config, "rpc/bhm_save_app_collection", {
    method: "POST",
    body: JSON.stringify({ p_collection: collection, p_data: data })
  });
  return Number(revision || 0);
}

async function handle(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode permintaan tidak didukung.");
  }
  if (req.method === "POST") ensureSameOrigin(req);
  const config = getConfig();
  const session = verifySession(cookieValue(req, COOKIE_NAME), config.sessionSecret);

  if (req.method === "GET") {
    if (!session) throw new ApiError(401, "AUTH_REQUIRED", "Silakan masuk kembali.");
    const state = await loadSharedState(config);
    json(res, 200, { ...state, user: { username: session.username, role: session.role } });
    return;
  }

  const body = await readBody(req);
  if (body.action === "login") {
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!["admin", "pengurus"].includes(username) || !password) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Username atau password salah.");
    }
    const role = await authenticate(config, username, password);
    if (!role) throw new ApiError(401, "INVALID_CREDENTIALS", "Username atau password salah.");
    const token = signSession({
      username,
      role,
      exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS
    }, config.sessionSecret);
    json(res, 200, { username, role }, {
      "Set-Cookie": sessionCookie(req, token, SESSION_DURATION_SECONDS)
    });
    return;
  }

  if (body.action === "logout") {
    json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
    return;
  }

  if (!session) throw new ApiError(401, "AUTH_REQUIRED", "Silakan masuk kembali.");

  if (body.action === "change-password") {
    if (session.role !== "admin") {
      throw new ApiError(403, "ADMIN_REQUIRED", "Hanya admin yang dapat mengubah password.");
    }
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!["admin", "pengurus"].includes(username) || password.length < 4) {
      throw new ApiError(400, "INVALID_PASSWORD", "Pilih akun dan gunakan password minimal 4 karakter.");
    }
    const changed = await supabaseRequest(config, "rpc/bhm_change_app_password", {
      method: "POST",
      body: JSON.stringify({ p_username: username, p_password: password })
    });
    if (changed !== true) {
      throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Akun tidak ditemukan.");
    }
    json(res, 200, { ok: true });
    return;
  }

  if (body.action === "save") {
    const collection = body.collection;
    if (collection !== "members" && collection !== "attendance") {
      throw new ApiError(400, "INVALID_COLLECTION", "Jenis data yang disimpan tidak valid.");
    }
    if (collection === "members" && session.role !== "admin") {
      throw new ApiError(403, "ADMIN_REQUIRED", "Hanya admin yang dapat mengubah data jamaah.");
    }
    if (!Array.isArray(body.data)) {
      throw new ApiError(400, "INVALID_DATA", "Data yang dikirim harus berupa daftar.");
    }
    if (Buffer.byteLength(JSON.stringify(body.data), "utf8") > MAX_BODY_BYTES) {
      throw new ApiError(413, "BODY_TOO_LARGE", "Ukuran data melebihi batas 4 MB.");
    }
    const revision = await saveCollection(config, collection, body.data);
    json(res, 200, { ok: true, revision });
    return;
  }

  throw new ApiError(400, "UNKNOWN_ACTION", "Aksi permintaan tidak dikenal.");
}

module.exports = async function apiHandler(req, res) {
  try {
    await handle(req, res);
  } catch (error) {
    if (error instanceof ApiError) {
      json(res, error.status, { error: error.message, code: error.code });
      return;
    }
    console.error("Unexpected shared-data API failure.", error);
    json(res, 500, {
      error: "Terjadi kesalahan pada server sinkronisasi.",
      code: "INTERNAL_ERROR"
    });
  }
};

module.exports._internals = { signSession, verifySession };
