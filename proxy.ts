import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const proxy = auth((request) => {
  if (request.auth) return NextResponse.next();
  const signInUrl = new URL("/sign-in", request.nextUrl);
  signInUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: ["/((?!api|sign-in|_next/static|_next/image|favicon.ico).*)"],
};
