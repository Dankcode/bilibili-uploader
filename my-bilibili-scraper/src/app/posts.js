import nextConnect from 'next-connect';
import { pool } from './db.js'; // Import the connection pool

const handler = nextConnect();

handler.post(async (req, res) => {
  const { Chinese_Name, Chinese_Desc, Eng_Name, Eng_Desc, BiliURL, Valid, Upload_Date, YoutubeURL } = req.body;

  try {
    const client = await pool.connect();
    const result = await client.query(
      'INSERT INTO your_table_name (Chinese_Name, Chinese_Desc, Eng_Name, Eng_Desc, BiliURL, Valid, Upload_Date, YoutubeURL) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [Chinese_Name, Chinese_Desc, Eng_Name, Eng_Desc, BiliURL, Valid, Upload_Date, YoutubeURL]
    );

    client.release();
    res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error creating post' });
  }
});

export default handler;