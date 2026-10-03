/**
 * GET /health — spec §9 alias of GET /api/health.
 * Same handler logic, no duplication: re-exports the /api/health route.
 * (This is an API route file serving JSON, not a page.)
 */
export { GET } from "@/app/api/health/route";
