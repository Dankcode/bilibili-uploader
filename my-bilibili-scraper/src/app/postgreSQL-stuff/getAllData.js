import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';
 
//calls for all the tables from the SQL of the specific username chosen 
//used for debugging finding frozen status etc
export default async function getAllData(requestedDataName) {
if (!requestedDataName){
  return null
}
else 
  try {
    const result = await sql`'SELECT * FROM public.bilibili_uploader WHERE Username = ${requestedDataName}`;
    console.log(result.rows)
    return (
        <div>
        <table>
        <thead>
        <tr>
            <th>Chinese Name</th>
            <th>Chinese Description</th>
            <th>English Name</th>
            <th>English Description</th>
            <th>BiliBili URL</th>
            <th>Valid_Upload</th>
            <th>Upload_Date</th>
            <th>Youtube URL</th>
        </tr>
        </thead>
        <tbody>
        {result.map((post, index) => (
            <tr key={index}> 
            <td>{post.Chinese_Name}</td>
            <td>{post.Chinese_Desc}</td>
            <td>{post.Eng_Name}</td>
            <td>{post.Eng_Desc}</td>
            <td>{post.BiliURL}</td>
            <td>{post.Valid_Upload}</td>
            <td>{post.Upload_Date}</td>
            <td>{post.YoutubeURL}</td>
            </tr>
        ))}
        </tbody>
        </table>
        </div> 
    )
  } catch (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
}