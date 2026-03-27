import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';
 
//gets the current status and calls for the specific video in action 
export default async function getCurrentStatus(Username, BiliURL) {
  try {
    const result = await sql`'SELECT * FROM public.bilibili_uploader WHERE Username = ${Username} AND BiliURL = ${BiliURL};`;
    return NextResponse.json({ result }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
}