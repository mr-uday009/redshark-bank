import { NextResponse } from "next/server";
import { authenticateUser, AuthError } from "@/lib/auth-service";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/session";
import {
  checkLoginIpRateLimit,
  checkLoginAccountRateLimit,
  clearLoginFailuresFor,
} from "@/lib/auth-rate-limit";

export async function POST(request: Request) {
  // Cheapest gate first: the per-IP bucket needs no body, so a flood is
  // rejected before we parse anything.
  const ipLimited = checkLoginIpRateLimit(request);
  if (ipLimited) return ipLimited;

  try {
    const body = await request.json();
    const { usernameOrEmail, password } = body ?? {};

    if (typeof usernameOrEmail !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    // Second gate: throttles repeated guesses against one account, which the
    // per-IP bucket cannot catch if the attempts come from many addresses.
    const accountLimited = checkLoginAccountRateLimit(usernameOrEmail);
    if (accountLimited) return accountLimited;

    const user = await authenticateUser(usernameOrEmail, password);
    const token = createSessionToken(user);

    // Success clears this account's failures so a legitimate user who mistyped
    // a few times is not left waiting. The per-IP bucket is untouched.
    clearLoginFailuresFor(usernameOrEmail);

    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return response;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("Login error:", err);
    return NextResponse.json({ error: "Login failed. Please try again." }, { status: 500 });
  }
}
