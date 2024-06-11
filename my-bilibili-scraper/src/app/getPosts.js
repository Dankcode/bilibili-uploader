import nextConnect from 'next-connect';
import { pool } from './db.js'; // Import the connection pool

const handler = nextConnect();

handler.get(async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM your_table_name');

    client.release();
    res.status(200).json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error fetching posts' });
  }
});

handler.post(async (req, res) => {
  // ... existing POST handler code
});

export default handler;