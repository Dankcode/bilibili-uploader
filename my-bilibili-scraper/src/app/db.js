import { Pool } from 'pg';

const pool = new Pool({
  user: 'your_username', // Replace with your PostgreSQL username
  password: 'your_password', // Replace with your PostgreSQL password
  host: 'your_host', // Replace with your PostgreSQL host
  database: 'your_database', // Replace with your PostgreSQL database name
});

export default pool;