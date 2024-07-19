const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: 'secret_77ntMw7OXmYfiV8SO9Eua0OfjonfAWyXRrOisMnwyDk',
});

// finds today's valid upload and tells all the other functions to finish the task
const GetValidUpload = async () => {
  const databaseId = '1fb726490c0947e9967a285846af19f5';
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        "and": [
        {
        property: "Valid_Upload",
        "select": {
          "equals": "Valid"
        }
        },
        {
          property: "Status",
          "status": {
            "equals": "Not started"
          }
        }
      ]
      },
    });
    console.log(response.results[0].id)
    return response.results[0]
  } catch (error) {
    console.error('Error retrieving page content:', error);
  }
};

export default GetValidUpload()