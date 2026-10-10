import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "bank_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-only-insecure-secret-change-me";

export interface SessionPayload {
  userId: number;
  username: string;
  email: string;
  fullName: string;
  iat: number;
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

export function createSessionToken(payload: Omit<SessionPayload, "iat">): string {
  const full: SessionPayload = { ...payload, iat: Date.now() };
  const encoded = base64url(JSON.stringify(full));
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (Date.now() - payload.iat > SESSION_MAX_AGE_SECONDS * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};
