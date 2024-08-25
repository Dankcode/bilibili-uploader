const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: 'secret_77ntMw7OXmYfiV8SO9Eua0OfjonfAWyXRrOisMnwyDk',
});
// finds today's valid upload and tells all the other functions to finish the task
const findNotStarted = async (databaseId) => {
  // const databaseId = '1fb726490c0947e9967a285846af19f5';
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
    return response.results[0].id
  } catch (error) {
    console.error('Error retrieving page content:', error);
  }
};
const findInProgress = async (databaseId) => {
  // const databaseId = '1fb726490c0947e9967a285846af19f5';
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
            "equals": "In progress"
          }
        }
      ]
      },
    });
    // console.log(response.results[0].id)
    return response.results[0].id
  } catch (error) {
    console.error('Error retrieving page content:', error);
  }
};
const getValidUpload = async (databaseId) => {
  try {
    // Attempt to find an "In progress" ID first
    const inProgressId = await findInProgress(databaseId);
    if (inProgressId) {
      console.log('In-progress ID found:', inProgressId);
      return inProgressId;
    }

    // If no "In progress" ID exists, find a "Not started" ID
    const notStartedId = await findNotStarted(databaseId);
    if (notStartedId) {
      console.log('Not started ID found:', notStartedId);
      return notStartedId;
    }

    // If neither exists, return null or handle accordingly
    console.log('No valid ID found');
    return null;
  } catch (error) {
    console.error('Error in findInProgressOrNotStarted:', error);
    throw error; // Optionally throw the error to be handled by the caller
  }
};

export {
  getValidUpload,
  findInProgress,
}