// src/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { UserStatus } from "@/models/User"; // Import UserStatus type
import { getAuthSecret } from "@/lib/authSecret";

// Define root paths based on role
const USER_AUTHENTICATED_ROOT = "/ui/dashboard";
const ADMIN_AUTHENTICATED_ROOT = "/ui/admin/dashboard";
const PENDING_APPROVAL_PAGE = ["/", "/registration", "/about", "/terms" , "/forgot-password"]; // Your designated page for pending users
const PROFILE_COMPLETE_PAGE = "/profile/complete-profile";
const PUBLIC_PATHS = ["/", "/registration", "/about", "/terms", "/forgot-password", "/reset-password"]; // Added /reset-password
const AUTH_PAGES = ["/", "/registration"]; // Pages to redirect away from if logged in (excluding reset-password)

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const secret = getAuthSecret();

  // --- Get Token ---
  let token = null;
  try {
    const cookieName = process.env.NODE_ENV === 'production'
      ? '__Secure-next-auth.session-token'
      : 'next-auth.session-token';
    token = await getToken({ req, secret, cookieName });
    console.log(`[Middleware] Path: ${pathname} | Token fetched:`, token ? `Exists (Role: ${token.role}, Status: ${token.status}, ProfileComplete: ${token.profileComplete})` : "None");
  } catch (error) {
    console.error(`[Middleware] Path: ${pathname} | Error calling getToken:`, error);
    const signInUrl = new URL("/", req.url);
    signInUrl.searchParams.set("error", "auth_check_failed");
    return NextResponse.redirect(signInUrl);
  }

  const isLoggedIn = !!token;
  const userRole = token?.role as "admin" | "user" | undefined;
  const userStatus = token?.status as UserStatus | undefined;
  const profileComplete = token?.profileComplete ?? false;

  // --- Handle Public Paths ---
  if (PUBLIC_PATHS.includes(pathname)) {
    // --- Allow access to reset-password regardless of login status ---
    if (pathname === "/reset-password") {
      console.log(`[Middleware] Allowing access to /reset-password.`);
      return NextResponse.next();
    }
    // --- End reset-password check ---
    if (isLoggedIn && AUTH_PAGES.includes(pathname)) {
      // --- FIX: Check if already on the pending page ---
      // If user is pending and already on the designated pending page, allow them to stay.
      if (userStatus === 'pending' && PENDING_APPROVAL_PAGE.includes(pathname)) {
          console.log(`[Middleware] Allowing pending user to stay on ${PENDING_APPROVAL_PAGE}.`);
          return NextResponse.next(); // Allow access
      }
      // --- End FIX ---

      // Determine redirect based on profile completion and status first
      if (!profileComplete) {
        console.log(`[Middleware] Logged-in user on ${pathname} with incomplete profile. Redirecting to ${PROFILE_COMPLETE_PAGE}.`);
        return NextResponse.redirect(new URL(PROFILE_COMPLETE_PAGE, req.url));
      }
      // If pending but NOT on the pending page, redirect them there.
      if (userStatus === 'pending') {
         console.log(`[Middleware] Logged-in user on ${pathname} with pending status. Redirecting to ${PENDING_APPROVAL_PAGE}.`);
         return NextResponse.redirect(new URL(PENDING_APPROVAL_PAGE[0], req.url));
      }
      // If profile complete and approved, redirect to dashboard
      const redirectUrl = userRole === "admin" ? ADMIN_AUTHENTICATED_ROOT : USER_AUTHENTICATED_ROOT;
      console.log(`[Middleware] Logged-in user on ${pathname}. Redirecting to ${redirectUrl}.`);
      return NextResponse.redirect(new URL(redirectUrl, req.url));
    }
    // Allow access to public path for non-logged-in users or logged-in users on non-auth public pages
    console.log(`[Middleware] Allowing public access to ${pathname}.`);
    const response = NextResponse.next();
    if (AUTH_PAGES.includes(pathname)) {
      response.headers.set("Cache-Control", "no-store, must-revalidate");
    }
    return response;
  }

  // --- Handle Authenticated Routes ---

  // 1. Check if logged in
  if (!isLoggedIn) {
    console.log(`[Middleware] Auth required for ${pathname}. Redirecting to sign-in.`);
    const signInUrl = new URL("/", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // 2. Check if profile is complete
  if (!profileComplete) {
    if (pathname === PROFILE_COMPLETE_PAGE) {
      console.log(`[Middleware] Allowing access to ${PROFILE_COMPLETE_PAGE} for incomplete profile.`);
      return NextResponse.next();
    }
    console.log(`[Middleware] Profile incomplete. Redirecting from ${pathname} to ${PROFILE_COMPLETE_PAGE}.`);
    return NextResponse.redirect(new URL(PROFILE_COMPLETE_PAGE, req.url));
  }

  // 3. Check account status
  if (userStatus === 'pending') {
    // --- FIX: Allow access if already on the pending page ---
    if (PENDING_APPROVAL_PAGE.includes(pathname)) {
       console.log(`[Middleware] Allowing pending user access to ${PENDING_APPROVAL_PAGE}.`);
       return NextResponse.next(); // Allow access
    }
    // --- End FIX ---
    // Redirect any other authenticated route to the pending page
    console.log(`[Middleware] Account pending. Redirecting from ${pathname} to ${PENDING_APPROVAL_PAGE}.`);
    return NextResponse.redirect(new URL(PENDING_APPROVAL_PAGE[0], req.url));
  }

  if (userStatus === 'rejected') {
    // Optional: Redirect to a specific "rejected" page or just back to root
    console.log(`[Middleware] Account rejected. Redirecting from ${pathname} to /.`);
    const rejectedUrl = new URL("/", req.url);
    rejectedUrl.searchParams.set("error", "Account rejected");
    return NextResponse.redirect(rejectedUrl);
  }

  // 4. Check Role-Based Access
  if (pathname.startsWith("/ui/admin")) {
    if (userRole !== "admin") {
      console.log(`[Middleware] Admin path denied for ${userRole}. Redirecting from ${pathname} to ${USER_AUTHENTICATED_ROOT}.`);
      return NextResponse.redirect(new URL(USER_AUTHENTICATED_ROOT, req.url));
    }
    console.log(`[Middleware] Admin access granted for ${pathname}.`);
  }

  // 5. Allow access to other authenticated routes
  console.log(`[Middleware] Allowing approved ${userRole} access to ${pathname}.`);
  return NextResponse.next();
}

// Config remains the same
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.).*)',
  ],
};
