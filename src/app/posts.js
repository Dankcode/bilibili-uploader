import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';
 
export async function GET(request) {
  try {
    const result =
      await sql`CREATE TABLE IF NOT EXIST ${user_name} ( 
        Chinese_Name varchar(255), 
        Chinese_Desc varchar(255), 
        Eng_Name varchar(255), 
        Eng_Desc varchar(255), 
        BiliURL varchar(255), 
        Valid_Upload varchar(255), 
        Upload_Date varchar(255), 
        YoutubeURL varchar(255), 
      );`;
    return NextResponse.json({ result }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
}