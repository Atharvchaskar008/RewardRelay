/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV !== "production";

/** An absolute http(s) URL's origin, or "" (relative URLs are same-origin already). */
function originOf(url) {
  try {
    return url && /^https?:\/\//.test(url) ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

/**
 * Content-Security-Policy. No 'unsafe-eval' in production (dev needs it for React Refresh).
 * 'unsafe-inline' scripts are still required by the App Router's inline bootstrap without nonces;
 * a nonce-based policy (middleware) is the production upgrade (see SECURITY.md).
 * Google/Firebase origins: phone sign-in (reCAPTCHA, Identity Toolkit, the authDomain iframe).
 */
function contentSecurityPolicy() {
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const authEmulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
  const google = "https://www.google.com https://www.gstatic.com https://apis.google.com";
  const firebase = [
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://www.googleapis.com",
  ].join(" ");
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${google}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://www.gstatic.com",
    "font-src 'self' data:",
    [
      "connect-src 'self'",
      firebase,
      google,
      originOf(process.env.NEXT_PUBLIC_RPC_URL),
      authEmulator ? `http://${authEmulator}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    `frame-src ${google} https://recaptcha.google.com${authDomain ? ` https://${authDomain}` : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  // Firebase sign-in may open popups; same-origin-allow-popups keeps them working.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@rewardrelay/shared"],
  // Node-only server SDK: load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["firebase-admin"],
  eslint: { dirs: ["src", "test", "scripts"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The landing page is a static site in public/landing; the test dashboard is the app itself.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/landing/index.html" }], afterFiles: [] };
  },
};

module.exports = nextConfig;
