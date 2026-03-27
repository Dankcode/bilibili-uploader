import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';
//creates initial table if doesnt exist

export async function GET(request) {
  const Username = '405832523'
  const BiliURL = 'https://www.bilibili.com/video/BV1UT421S7kB/?spm_id_from=333.999.0.0&vd_source=13ef93c0b77fc1861411754dcfa41c79'
  const Valid_Upload = 'true'
  try {
      await sql`UPDATE public.bilibili_uploader SET Valid_Upload = ${Valid_Upload} WHERE Username = ${Username} AND BiliURL = ${BiliURL};`;
  } catch (error) {
      const result = await sql`SELECT * FROM pg_stat_activity WHERE state = '42601' ;`;
        //insert values for the initial creation here
    return NextResponse.json({ error, result }, { status: 500 });
  }
  const pets = await sql`SELECT * FROM public.bilibili_uploader;`;
  return NextResponse.json({ pets }, { status: 200 });
}
// ${'405832523'}, ${'https://www.bilibili.com/video/BV1UT421S7kB/?spm_id_from=333.999.0.0&vd_source=13ef93c0b77fc1861411754dcfa41c79'});
//page to go to when something gets stuck
// export async function GET(request) {
//   try {
//     const result = await sql`CREATE TABLE public.bilibili_uploader ( Username varchar(255), Chinese_Name varchar(255), Chinese_Desc varchar(255), Eng_Name varchar(255), Eng_Desc varchar(255), BiliURL varchar(255), Valid_Upload varchar(255), Upload_Date varchar(255), YoutubeURL varchar(255), Upload_Status varchar(255) );`;
//       //insert values for the initial creation here
//       console.log('dank')
//     return NextResponse.json({ result }, { status: 200 });
//   } catch (error) {
//       const result = await sql`SELECT * FROM pg_stat_activity WHERE state = '42601' ;`;
//         //insert values for the initial creation here
//     return NextResponse.json({ error, result }, { status: 500 });
//   }
// }