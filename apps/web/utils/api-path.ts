// Next.js basePath is applied to navigation and asset URLs but NOT to raw
// relative fetch() calls, so all client API paths must be prefixed centrally.
export const basePath =
  process.env.NEXT_PUBLIC_BASE_URL?.replace(/^https?:\/\/[^/]+/, "")?.replace(
    /\/+$/,
    "",
  ) ?? "";

export const apiPath = (path: `/${string}`) => `${basePath}${path}`;

/** Removes the deployment basePath from a URL pathname (no-op at root). */
export const stripBasePath = (pathname: string) =>
  basePath && pathname.startsWith(basePath)
    ? pathname.slice(basePath.length)
    : pathname;
