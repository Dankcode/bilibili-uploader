import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';
//update the status of the tables here
//the updater will AWAYS have the username and bilibili URL the same to know which one its updating so that it doesnt reinsert or insert wrong

//creates the base 
async function updateUsername(Username, BiliURL) {
    try {
      const result =
        await sql`INSERT INTO public.bilibili_uploader( Username, BiliURL ) VALUES ( ${Username}, ${BiliURL} );`;
        //insert values for the initial creation here
      return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
}

async function updateStatus(Username, BiliURL, Upload_Status) {
    try {
      const result =
        await sql`UPDATE public.bilibili_uploader SET Upload_Status = ${Upload_Status} WHERE Username = ${Username} AND BiliURL = ${BiliURL};`;
      return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
}
async function updateChinese(Username, BiliURL, Chinese_Name, Chinese_Desc) {
    try {
      const result =
        await sql`UPDATE public.bilibili_uploader SET Chinese_Name = ${Chinese_Name} Chinese_Desc = ${Chinese_Desc} WHERE Username = ${Username} AND BiliURL = ${BiliURL};`;
      return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
}
async function updateEnglish(Username, BiliURL, Eng_Name, Eng_Desc) {
    try {
      const result =
        await sql`UPDATE public.bilibili_uploader SET Eng_Name = ${Eng_Name} Eng_Desc = ${Eng_Desc} WHERE Username = ${Username} AND BiliURL = ${BiliURL};`;
      return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
}
async function updateValidUpload(Username, BiliURL, Valid_Upload) {
    try {
      const result =
        await sql`UPDATE public.bilibili_uploader SET Valid_Upload = ${Valid_Upload} WHERE Username = ${Username} AND BiliURL = ${BiliURL};`
      return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
}
async function updateUploadDate(Username, BiliURL, Upload_Date) {
    try {
      const result =
        await sql`UPDATE public.bilibili_uploader SET Upload_Date = ${Upload_Date} WHERE Username = ${Username} AND BiliURL = ${BiliURL};`;
      return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
}
async function updateYoutubeURL(Username, BiliURL, YoutubeURL) {
    try {
      const result =
        await sql`UPDATE public.bilibili_uploader SET YoutubeURL = ${YoutubeURL} WHERE Username = ${Username} AND BiliURL = ${BiliURL};`;
      return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
}

export {
  updateUsername,
  updateChinese,
  updateEnglish,
  updateStatus,
  updateUploadDate,
  updateValidUpload,
  updateYoutubeURL,
}