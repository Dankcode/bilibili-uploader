import { withOperator } from '../../../../lib/agent/auth.js';
import { listYouTubePosts, saveYouTubePost, approveYouTubePost, generateYouTubePost } from '../../../../lib/youtube/posts.js';

export const GET = withOperator(async () => Response.json({ posts: listYouTubePosts() }));
export const POST = withOperator(async (request) => {
  try {
    const input = await request.json();
    if (input.action === 'generate') return Response.json(await generateYouTubePost(input));
    if (input.action === 'approve') return Response.json({ post: approveYouTubePost(input.id, input.ifMatch) });
    if (input.action !== 'save') throw new Error('Unknown post action');
    return Response.json({ post: saveYouTubePost(input) });
  } catch (error) { return Response.json({ error: error.message }, { status: error.status || 400 }); }
});
