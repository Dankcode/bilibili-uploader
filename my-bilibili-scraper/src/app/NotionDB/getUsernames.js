const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: 'secret_77ntMw7OXmYfiV8SO9Eua0OfjonfAWyXRrOisMnwyDk',
});

// Function to get a page's content
const GetUsernames = async () => {
  try {
    const databaseId = '1fb726490c0947e9967a285846af19f5';
    const response = await notion.databases.retrieve({ database_id: databaseId });
    console.log('Title name:', response.title[0].text.content);
    return response.title[0].text.content
  } catch (error) {
    console.error('Error retrieving page content:', error);
  }
};

export default GetUsernames()