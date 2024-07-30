import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';
import { find_newUpload } from '@/app/checker';
import Scraper from '../biliscraper';
const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: 'secret_77ntMw7OXmYfiV8SO9Eua0OfjonfAWyXRrOisMnwyDk',
});
//update the status of the tables here
//the updater will AWAYS have the username and bilibili URL the same to know which one its updating so that it doesnt reinsert or insert wrong
//creates a new page in notion when there's a new entry, this runs everytime it's time for and upload
// creates a new array by mapping thru the current notion list 
//filters the scraped list to remove any existing URLs
// the remaining URL is then added to the notion table 
const getUrlList = async (databaseId) => {
  // const databaseId = '1fb726490c0947e9967a285846af19f5';
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
    });
    return response.results.map((Val, index) => Val.properties.BiliBili_URL.rich_text[0].text.content)
  } catch (error) {
    console.error('Error getting url list:', error);
  }
};
async function GetTodayUpload(notionDatabaseId, databaseId) {
  let retries = 0; // Counter for retry attempts
  const maxRetries = 3; // Set a maximum number of retries
  let pageNumber = 1
  while (retries < maxRetries) {
    try {
      console.log('gottest db id'+ notionDatabaseId)
      const getScraper = await Scraper(`https://space.bilibili.com/${notionDatabaseId}/video?tid=0&pn=${pageNumber}&keyword=&order=pubdate`);
      const getList = await getUrlList(databaseId);
      const getData = await find_newUpload(getScraper, getList);

      // Check if getData is empty or undefined (no data received)
      if (!getData) {
        console.warn('No data received from server. Retrying...');
        retries++;
        continue; // Skip to the next iteration
      }
      if (getData.length === 0) {
      // this means that there are no more new videos on the current page, scrape the second page
        console.log('no more new videos on the current page')
        pageNumber++;
        retries++;
        continue; // Skip to the next iteration
      }
      // Successful data retrieval
      // console.log(getData);
      return CreateInitialData(getData.link, getData.name, 'still no cn desc yet')
    } catch (error) {
      console.error('Error retrieving page content:', error);
      retries = maxRetries; // Stop retrying on actual errors
    }
  }
  // If retries reach the limit, log an error and exit
  console.error('Failed to retrieve data after', maxRetries, 'retries.');
  return null; // Or throw an error if appropriate
}
const CreateInitialData = async (BiliURL, Chinese_Name, Chinese_Desc) => {
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
                      "content": Chinese_Name
                  }
              }
          ]
      },
      "Chinese_Description": {
        "rich_text": [
            {
              'type': 'text',
                "text": {
                    "content": Chinese_Desc
                }
            }
        ]
      },  
      "BiliBili_URL": {
        "rich_text": [
            {
              'type': 'text',
                "text": {
                    "content": BiliURL
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
          "name": "Valid"
        }
      },  
    },
    });
    // console.log('Page created:', response);
    return response
  } catch (error) {
    console.error('Error querying database:', error);
  }
};
//creates the base 
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
  // console.log(response);
  return response
} catch (error) {
  console.log('status err' + error)
}
}
async function UpdateCompleted(pageId) {
  try {
  const response = await notion.pages.update({
    page_id: pageId,
    properties: {
      "Status": {
        "status": {
          "name": "Done"
        }
      }
    },
  });
  // console.log(response);
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
        "Chinese_Name": {
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
    // console.log(response);
    return response
  } catch (error) {
    console.log('update chinese err' + error)
  }
}
async function updateEnglish(pageId, Eng_Name, Eng_Desc) {
  try {
    const response = await notion.pages.update({
      page_id: pageId,
      properties: {
        "English_Name": {
          "title": [
            {
              "type": "text",
              "text": {
                "content": Eng_Name
              }
            }
          ]
        },
        "English_Description": {
          "rich_text": [
            {
              "type": "text",
              "text": {
                "content": Eng_Desc
              }
            },
          ]
        }
      },
    });
    // console.log(response);
    return response
  } catch (error) {
    console.log('update chinese err' + error)
  }
}
async function updateValidUpload(pageId, Valid_Upload) {
  try {
    const response = await notion.pages.update({
      page_id: pageId,
      properties: {
        "Valid_Upload": {
          "select": {
            "equals": Valid_Upload
          }
        }
      },
    });
    // console.log(response);
    return response
  } catch (error) {
    console.log('status err' + error)
  }
}
function getCurrentDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are zero-based, so add 1
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function updateUploadDate(pageId) {
  const Upload_Date = getCurrentDate();
  try {
    const response = await notion.pages.update({
      page_id: pageId,
      properties: {
        "Release_Date": {
          "rich_text": [
            {
              'type': 'date',
              "text": {
                "content": Upload_Date
            }
            }
          ]
        },
      },
    });
    // console.log(response);
    return response
  } catch (error) {
    console.log('update chinese err' + error)
  }
}
async function updateYoutubeURL(pageId, YoutubeURL) {
  try {
    const response = await notion.pages.update({
      page_id: pageId,
      properties: {
        "Youtube_URL": {
          "rich_text": [
            {
              "type": "text",
              "text": {
                "content": YoutubeURL
              }
            },
          ]
        }
      },
    });
    // console.log(response);
    return response
  } catch (error) {
    console.log('update chinese err' + error)
  }
}
async function UpdateError(pageId, errorMessage) {
  try {
    const response = await notion.pages.update({
      page_id: pageId,
      properties: {
        "Error": {
          "rich_text": [
            {
              "type": "text",
              "text": {
                "content": errorMessage
              }
            },
          ]
        }
      },
    });
  // console.log(response);
  return response
} catch (error) {
  console.log('status err' + error)
}
}
export {
  GetTodayUpload,
  CreateInitialData,
  UpdateChinese,
  updateEnglish,
  UpdateStatus,
  updateUploadDate,
  updateValidUpload,
  updateYoutubeURL,
  UpdateError,
  UpdateCompleted,
}