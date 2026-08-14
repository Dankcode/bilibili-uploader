import { getYouTubeChannels } from '../../../../lib/db/sqlite';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ channels: getYouTubeChannels() });
}
