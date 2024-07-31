const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: 'secret_77ntMw7OXmYfiV8SO9Eua0OfjonfAWyXRrOisMnwyDk',
});

// Function to get a page's content
const getDatabaseData = async (databaseId) => {
  try {
    const response = await notion.databases.retrieve({ database_id: databaseId });
    // console.log('Title name:', response.title[0].text.content);
    const getTitle = response.title[0].text.content;
    return getTitle
  } catch (error) {
    console.error('Error retrieving page content:', error);
  }
};

const getPageData = async (pageId) => {
  try {
    const response = await notion.pages.retrieve({
      page_id: pageId
      });
      // console.log('Title name:', response.properties.BiliBili_URL.rich_text[0].plain_text);
      const chinese_name = response.properties.Chinese_Name.title[0].plain_text;
      const bilibiliUrl = response.properties.BiliBili_URL.rich_text[0].plain_text;
      // console.log('Chinese Name:', chinese_name);
      // console.log('Bilibili URL:', bilibiliUrl);
  
      return {
        chinese_name: chinese_name,
        bilibiliUrl: bilibiliUrl,
      };
  } catch (error) {
    console.error('Error retrieving page content:', error);
  }
};
const getBiliBiliUrl = async (pageId) => {
  try {
    const response = await notion.pages.retrieve({
      page_id: pageId
      });
    console.log('Title name:', response.properties.BiliBili_URL.title[0].plain_text);
    return response.properties.BiliBili_URL.title[0].plain_text
  } catch (error) {
    console.error('Error retrieving page content:', error);
  }
};
export {
  getDatabaseData,
  getPageData,
  getBiliBiliUrl,
}