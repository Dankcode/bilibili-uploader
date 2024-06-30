import axios from 'axios';

const BILIBILI_API_URL = 'https://api.bilibili.com/x/player/playurl';

export default async function handler(req, res) {
  const { bvid, cid, sessdata } = req.query;

  if (!avid || !cid || !sessdata) {
    return res.status(400).json({ error: 'Missing required query parameters' });
  }

  try {
    const response = await axios.get(BILIBILI_API_URL, {
      params: {
        bvid,
        cid,
        qn: 112,
        fnval: 0,
        fnver: 0,
        fourk: 1,
      },
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Cookie: `SESSDATA=${sessdata}`,
      },
    });

    const { data } = response.data;

    if (data && data.durl) {
      return res.status(200).json({ url: data.durl[0].url });
    } else {
      return res.status(500).json({ error: 'Failed to fetch video URL' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}