import { withOperator } from '../../../../lib/agent/auth.js';
import { getYouTubeChannels } from '../../../../lib/db/sqlite';

export const dynamic = 'force-dynamic';

async function handleGET() {
  return Response.json({ channels: getYouTubeChannels() });
}

export const GET = withOperator(handleGET);
