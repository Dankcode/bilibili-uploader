import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';
import { videoLengthChecker, find_newUpload } from '@/app/checker';
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
  const retryDelay = 2000; // Initial delay in milliseconds (2 seconds)
  let baseUrl = `https://space.bilibili.com/${notionDatabaseId}/video?tid=0&pn=1&keyword=&order=pubdate`; // Initial URL

  while (retries < maxRetries) {
    try {
      console.log('Fetching from database ID:', notionDatabaseId);

      // Retry the Scraper function with exponential backoff if it fails
      const getScraper = await retryScraper(baseUrl, retries, retryDelay);

      // const approvedUsers = videoLengthChecker(getScraper);
      const approvedUsers = getScraper;
      const getList = await getUrlList(databaseId);
      const getData = await find_newUpload(approvedUsers, getList, baseUrl);

      // Check if getData.newUpload is null (no new upload found)
      if (!getData.newUpload) {
        console.log('No new videos found on this page, moving to next page.');
        baseUrl = moveToNextPage(baseUrl); // Generate the URL for the next page
        retries++;
        continue; // Skip to the next iteration
      }

      // Successful data retrieval
      console.log('New upload found:', getData.newUpload);
      return CreateInitialData(databaseId, getData.newUpload.link, getData.newUpload.name, 'still no cn desc yet');
    } catch (error) {
      console.error('Error retrieving page content:', error);
      retries = maxRetries; // Stop retrying on actual errors
    }
  }

  // If retries reach the limit, log an error and exit
  console.error('Failed to retrieve data after', maxRetries, 'retries.');
  return null; // Or throw an error if appropriate
}

// Retry wrapper for Scraper function with exponential backoff
async function retryScraper(url, retryCount, delay) {
  try {
    return await Scraper(url); // Attempt the scraper
  } catch (error) {
    console.error(`Scraper failed (attempt ${retryCount + 1}):`, error);

    if (retryCount >= 5) {
      throw new Error('Max retries reached, failing scraper.');
    }

    // Exponential backoff
    const backoffTime = delay * (2 ** retryCount);
    console.log(`Retrying in ${backoffTime / 1000} seconds...`);

    await new Promise(resolve => setTimeout(resolve, backoffTime));
    return retryScraper(url, retryCount + 1, delay); // Retry with increased count and delay
  }
}
const CreateInitialData = async (databaseId, BiliURL, Chinese_Name, Chinese_Desc) => {
  // const databaseId = '1fb726490c0947e9967a285846af19f5';
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
          "rich_text": [
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
  getCurrentDate,
}