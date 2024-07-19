import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';
const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: 'secret_77ntMw7OXmYfiV8SO9Eua0OfjonfAWyXRrOisMnwyDk',
});
//update the status of the tables here
//the updater will AWAYS have the username and bilibili URL the same to know which one its updating so that it doesnt reinsert or insert wrong

const QueryDatabase = async () => {
  const databaseId = '1fb726490c0947e9967a285846af19f5';
  try {
    const response = await notion.pages.create({
      parent: {
        "type": "database_id",
        "database_id": databaseId
    },
      properties: {
        "Chinese_Name": {
          "title": [
              {
                  'type': 'text',
                  "text": {
                      "content": "Tusca34242"
                  }
              }
          ]
      },
      "Chinese_Description": {
        "rich_text": [
            {
              'type': 'text',
                "text": {
                    "content": "A dark green leafy vegetable"
                }
            }
        ]
      },  
      "English_Name": {
        "rich_text": [
            {
              'type': 'text',
                "text": {
                    "content": "A dark green leafy vegetable"
                }
            }
        ]
      },  
      "English_Description": {
        "rich_text": [
            {
              'type': 'text',
                "text": {
                    "content": "A dark green leafy vegetable"
                }
            }
        ]
      },  
      "Youtube_URL": {
          "rich_text": [
              {
                'type': 'text',
                  "text": {
                      "content": "A dark green leafy vegetable"
                  }
              }
          ]
      },
      "Release_Date": {
        "date": {
          "start": "2023-02-23"
        }
      },  
      "BiliBili_URL": {
        "rich_text": [
            {
              'type': 'text',
                "text": {
                    "content": "A dark green leafy vegetable"
                }
            }
        ]
      },  
      "Status": {
        "status": {
          "name": "Not started"
        }
      },
      "Valid_Upload": {
        "select": {
          "equals": "Valid"
        }
      },  
    },
    });
    console.log('Page created:', response);
  } catch (error) {
    console.error('Error querying database:', error);
  }
};
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
//get valid upload will find the suitable video and grab the notion pageId
async function UpdateStatus(pageId) {
  try {
  const response = await notion.pages.update({
    page_id: pageId,
    properties: {
      "Status": {
        "status": {
          "name": "In progress"
        }
      }
    },
  });
  console.log(response);
  return response
} catch (error) {
  console.log('status err' + error)
}
}
async function UpdateChinese(pageId, BiliURL, Chinese_Name, Chinese_Desc) {
  try {
    const response = await notion.pages.update({
      page_id: pageId,
      properties: {
        "Name": {
          "title": [
            {
              "type": "text",
              "text": {
                "content": Chinese_Name
              }
            }
          ]
        },
        "Chinese_Description": {
          "rich_text": [
            {
              "type": "text",
              "text": {
                "content": Chinese_Desc
              }
            },
          ]
        },
        "BiliBili_URL": {
          "rich_text": [
            {
              "type": "text",
              "text": {
                "content": BiliURL
              }
            },
          ]
        }
      },
    });
    console.log(response);
    return response
  } catch (error) {
    console.log('update chinese err' + error)
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
  QueryDatabase,
  updateUsername,
  UpdateChinese,
  updateEnglish,
  UpdateStatus,
  updateUploadDate,
  updateValidUpload,
  updateYoutubeURL,
}