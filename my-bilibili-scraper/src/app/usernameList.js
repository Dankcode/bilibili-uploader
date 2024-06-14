import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';
 
export default async function UsernameList() {
  try {
    const users =
    await sql`SELECT DISTINCT username FROM public.bilibili_uploader;`;
    console.log(result.rows)

    return users;
  } catch (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
}