import VideoInput from './bilibili-downloader';
import UploadVideo from './uploadYoutube';
import { UpdateStatus, updateEnglish, updateYoutubeURL, updateUploadDate, UpdateCompleted, getCurrentDate } from './NotionDB/updateData';
import { GetTodayUpload } from './NotionDB/updateData';
import { getValidUpload, findInProgress } from './NotionDB/getValidUpload';
import {getDatabaseData, getPageData} from './NotionDB/getNotionData'
import getEnglishName from './aiStuff/getEnglish';

export default function myPage() {
  
   const executeWorkflow = async () => {
      const databaseId = '1fb726490c0947e9967a285846af19f5'
   try {
    let notionDatabaseId= await getDatabaseData(databaseId)
    let uploadId = await getValidUpload(databaseId);
    let inProgressId = await findInProgress(databaseId);
    console.log('inprogres id ' + inProgressId)
  if (inProgressId) {
    const pageData = await getPageData(inProgressId)
    const Chinese_Name = pageData.chinese_name;
    const bilibiliURL = pageData.bilibiliUrl;
    console.log('chinese name' + Chinese_Name)
  // Run the AI API to get an Eng Desc and Eng Name
  //   const English_Name = 'test'
    const English_Name = await getEnglishName(Chinese_Name)
    const English_Desc = 'testing'
    const date = getCurrentDate()
  // when AI API is finished, update the Eng Name and decription
    await updateEnglish(inProgressId, English_Name, English_Desc);
    // Run the videoDownloader with the in progress data
    await VideoInput(date, bilibiliURL);
    // if download success then update status to "Done"
    console.log('updating db with complete status')
    await UpdateCompleted(inProgressId);
    console.log('begining uploading process...')
  // being upload onto youtube
    const uploadedYoutubeUrl = await UploadVideo(`./Videos/${date}.mp4`, `${English_Name}`, 'This is a description of my awesome video.')
  // if success then return the Youtube URL
    await updateYoutubeURL(inProgressId, uploadedYoutubeUrl)
    // set upload Date to the date
    await updateUploadDate(inProgressId);
  }
  if (uploadId && !inProgressId) {
    // 2nd checks the notion DB for a valid upload with getValidUpload from getvalidupload.js to get the id of the upload
    await UpdateStatus(uploadId);
    const pageData = await getPageData(inProgressId)
    const Chinese_Name = pageData.chinese_name;
    const bilibiliURL = pageData.bilibiliUrl;
    console.log('chinese name' + Chinese_Name)
  // Run the AI API to get an Eng Desc and Eng Name
  //   const English_Name = 'test'
    const English_Name = await getEnglishName(Chinese_Name)
    const English_Desc = 'testing'
    const date = getCurrentDate()
  // when AI API is finished, update the Eng Name and decription
    await updateEnglish(inProgressId, English_Name, English_Desc);
    // Run the videoDownloader with the in progress data
    await VideoInput(date, bilibiliURL);
    // if download success then update status to "Done"
    console.log('updating db with complete status')
    await UpdateCompleted(inProgressId);
    console.log('begining uploading process...')
  // being upload onto youtube
    const uploadedYoutubeUrl = await UploadVideo(`./Videos/${date}.mp4`, `${English_Name}`, 'This is a description of my awesome video.')
  // if success then return the Youtube URL
    await updateYoutubeURL(inProgressId, uploadedYoutubeUrl)
    // set upload Date to the date
    await updateUploadDate(inProgressId);
    }
    else {
      await GetTodayUpload(notionDatabaseId, databaseId);
      await UpdateStatus(uploadId);
      const pageData = await getPageData(inProgressId)
      const Chinese_Name = pageData.chinese_name;
      const bilibiliURL = pageData.bilibiliUrl;
      console.log('chinese name' + Chinese_Name)
    // Run the AI API to get an Eng Desc and Eng Name
    //   const English_Name = 'test'
      const English_Name = await getEnglishName(Chinese_Name)
      const English_Desc = 'testing'
      const date = getCurrentDate()
    // when AI API is finished, update the Eng Name and decription
      await updateEnglish(inProgressId, English_Name, English_Desc);
      // Run the videoDownloader with the in progress data
      await VideoInput(date, bilibiliURL);
      // if download success then update status to "Done"
      console.log('updating db with complete status')
      await UpdateCompleted(inProgressId);
      console.log('begining uploading process...')
    // being upload onto youtube
      const uploadedYoutubeUrl = await UploadVideo(`./Videos/${date}.mp4`, `${English_Name}`, 'This is a description of my awesome video.')
    // if success then return the Youtube URL
      await updateYoutubeURL(inProgressId, uploadedYoutubeUrl)
      // set upload Date to the date
      await updateUploadDate(inProgressId);
    }
   } catch (error) {
    console.log('Error in workflow:', error);
   }
  }
  return executeWorkflow();
// a successful upload would look like this

// the npm run dev will serve as a troubleshoot runs the same as above when button is pressed
  //  return (
  //   <div>
  //     {/* <GetTodayUpload /> */}
  //        {/* {response} */}
  //      {/* <Scraper /> */}
  //      {/* <VideoDownloader /> */}
  //   </div>
  //  )
 }
/*
make a new button function where it checks for status that are not 'complete'
*/

// import React, { useState, useEffect }from 'react';
// import UsernameList from './postgreSQL-stuff/getUsernames';
// import getAllData from './postgreSQL-stuff/getAllData';

// const TableList = () => {
//   const [users, setUsers] = useState([]);

//   useEffect(() => {
//     async function fetchData() {
//         const retrievedUsers = UsernameList();
//         setUsers(retrievedUsers);
//     };
//     fetchData();
//   },[users]);

//   console.log(users)
//   return (
//     <div>
//       <ul>
//           <h1>Tables for Users</h1>
//           {users.length > 0 ? (
//             <ul>
//               {users.map((val, index) => (
//                 <li key={index} onClick={(e) => {getAllData(val)}}>
//                   {val}
//                 </li>
//               ))}
//             </ul>
//           ) : (
//             <p>No tables found for users.</p>
//           )}
//       </ul>
//     </div>
//     );
// };


// export default TableList;
