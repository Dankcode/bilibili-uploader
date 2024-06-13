import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';
 
//calls for all the tables from the SQL of the specific username chosen 
//get the data from all the tables to compare with the scraper
export default async function getSQLArray(requestedDataName) {
if (!requestedDataName){
  return null
}
else 
  try {
    const result = await sql`'SELECT * FROM public.bilibili_uploader WHERE Username = ${requestedDataName}`;
    console.log(result.rows)
    requestedArray = []
    return requestedDataName = [...result]
  } catch (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
}