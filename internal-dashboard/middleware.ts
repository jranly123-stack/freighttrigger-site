import { NextRequest, NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="FreightTrigger Ops", charset="UTF-8"'
    }
  });
}

function parseBasicAuth(header: string) {
  if (!header.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const requiredPassword = process.env.INTERNAL_DASHBOARD_PASSWORD;
  const requiredUser = process.env.INTERNAL_DASHBOARD_USER || "freighttrigger";

  if (!requiredPassword) {
    if (process.env.NODE_ENV === "development") return NextResponse.next();
    return new NextResponse("Internal dashboard password is not configured.", {
      status: 503
    });
  }

  const credentials = parseBasicAuth(request.headers.get("authorization") || "");
  if (
    credentials?.username === requiredUser &&
    credentials.password === requiredPassword
  ) {
    return NextResponse.next();
  }

  return unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
