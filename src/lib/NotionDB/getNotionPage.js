const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: 'secret_77ntMw7OXmYfiV8SO9Eua0OfjonfAWyXRrOisMnwyDk',
});

// Function to get a page's content
const GetPageId = async () => {
  const databaseId = '1fb726490c0947e9967a285846af19f5';
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: "Valid_Upload",
        "select": {
          "equals": "Valid"
        }
      },
    });
    // console.log(response.results[0].properties.Chinese_Name.title[0].text.content)
    // console.log(response.results[0].properties.Youtube_URL.rich_text[0].text.content)
    // returns all the valid uploads 
    return response.results
  } catch (error) {
    console.error('Error retrieving page content:', error);
  }
};

export default GetCurrentStatus()