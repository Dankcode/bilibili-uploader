import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';
//update the status of the tables here
//the updater will AWAYS have the username and bilibili URL the same to know which one its updating so that it doesnt reinsert or insert wrong

//creates the base 
async function updateUsername(Username, BiliURL) {
    try {
      const result =
        await sql`INSERT INTO public.bilibili_uploader( 
            Username, 
            BiliURL,
        )
        VALUES
        (
          ${Username},
          ${BiliURL},
        )
        ;`;
        //insert values for the initial creation here
      return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
}

async function updateStatus(Username, BiliURL, Upload_Status) {
    try {
      const result =
        await sql`INSERT INTO public.bilibili_uploader WHERE Username = ${Username} AND BiliURL = ${BiliURL};( 
            Upload_Status, 
        )
        VALUES
        (
          ${Upload_Status},
        )
        ;`;
      return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
}
async function updateChinese(Username, BiliURL, Chinese_Name, Chinese_Desc) {
    try {
      const result =
        await sql`INSERT INTO public.bilibili_uploader WHERE Username = ${Username} AND BiliURL = ${BiliURL};( 
            Chinese_Name, 
            Chinese_Desc, 
        )
        VALUES
        (
          ${Chinese_Name},
          ${Chinese_Desc},
        )
        ;`;
        //insert values for the initial creation here
      return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
}
async function updateEnglish(Username, BiliURL, Eng_Name, Eng_Desc) {
    try {
      const result =
        await sql`INSERT INTO public.bilibili_uploader WHERE Username = ${Username} AND BiliURL = ${BiliURL};( 
            Eng_Name, 
            Eng_Desc, 
        )
        VALUES
        (
          ${Eng_Name},
          ${Eng_Desc},
        )
        ;`;
        //insert values for the initial creation here
      return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
}
async function updateValidUpload(Username, BiliURL, Valid_Upload) {
    try {
      const result =
        await sql`INSERT INTO public.bilibili_uploader WHERE Username = ${Username} AND BiliURL = ${BiliURL};( 
            Valid_Upload,
        )
        VALUES
        (
          ${Valid_Upload},
        )
        ;`;
        //insert values for the initial creation here
      return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
}
async function updateUploadDate(Username, BiliURL, Upload_Date) {
    try {
      const result =
        await sql`INSERT INTO public.bilibili_uploader WHERE Username = ${Username} AND BiliURL = ${BiliURL};( 
            Upload_Date,
        )
        VALUES
        (
          ${Upload_Date},
        )
        ;`;
        //insert values for the initial creation here
      return NextResponse.json({ result }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
}
async function updateYoutubeURL(Username, BiliURL, YoutubeURL) {
    try {
      const result =
        await sql`INSERT INTO public.bilibili_uploader WHERE Username = ${Username} AND BiliURL = ${BiliURL};( 
            YoutubeURL,
        )
        VALUES
        (
          ${YoutubeURL},
        )
        ;`;
        //insert values for the initial creation here
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