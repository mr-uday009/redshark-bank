import { NextResponse } from "next/server";
import { registerUser, AuthError } from "@/lib/auth-service";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/session";
import { checkRegisterRateLimit } from "@/lib/auth-rate-limit";

export async function POST(request: Request) {
  // Registration is per-IP only — there is no account to key on yet. The
  // bucket is deliberately tighter than login's, since mass account creation
  // is the abuse we care about here.
  const limited = checkRegisterRateLimit(request);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { username, email, fullName, password } = body ?? {};

    if (
      typeof username !== "string" ||
      typeof email !== "string" ||
      typeof fullName !== "string" ||
      typeof password !== "string"
    ) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const user = await registerUser({ username, email, fullName, password });
    const token = createSessionToken(user);

    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return response;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Register error:", err);
    return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 500 });
  }
}
