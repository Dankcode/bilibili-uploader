export const dynamic = 'force-dynamic';
// Compatibility for older clients. No session or operator cookie is needed.
export async function GET() { return Response.json({ required: false, authenticated: true, localPairing: false }, { headers: { 'Cache-Control': 'no-store' } }); }
export const POST = GET;
