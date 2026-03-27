import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';
 
export default async function UsernameList(requestedDataName) {
if (!requestedDataName){
  return null
}
else 
  try {
    const result = await sql`SELECT DISTINCT Username FROM bilibili_uploader;`;
    console.log(result)
    return (
      <div>
        <li>
          {result.map((post, index) => (
            <ul key={index}>
              {post}
            </ul>
          ))}
        </li>
      </div>
    )
  } catch (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
}