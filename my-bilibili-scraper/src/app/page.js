import React from 'react';
// import PostForm from './Form';
import Scraper from './biliscraper';
import VideoInput from './bilibili-downloader';
import UsernameList from './NotionDB/getNotionData';
import { QueryDatabase, updateEnglish, updateYoutubeURL } from './NotionDB/updateData';
import { GetTodayUpload } from './NotionDB/updateData';
import { UpdateChinese } from './NotionDB/updateData';
import {GetChineseName, GetUsernames } from './NotionDB/getNotionData'
import getEnglishName from './aiStuff/getEnglish';

export default function myPage() {
  const databaseId = '1fb726490c0947e9967a285846af19f5'
  let notionDatabaseId = GetUsernames(databaseId)
   const pageId = '9a51f3fc-e89d-40a1-a3f1-594278ad932f'; // Replace with your actual page ID


   const Chinese_Desc = '这是一个示例描述'; // Example Chinese description
   const executeWorkflow = async () => {
   try {
// first gets today's upload
  await GetTodayUpload(notionDatabaseId);
// 2nd checks the notion DB for a valid upload with getValidUpload from getvalidupload.js to get the id of the upload
  let uploadId = GetValidUpload();
// change the selected table to In progress
  await UpdateStatus(uploadId);
// run the checker for In progress rows
  await findInProgress();
  const Chinese_Name = await getChineseName(uploadId); // Example Chinese name
// Run the AI API to get an Eng Desc and Eng Name
  const English_Name = await getEnglishName(Chinese_Name)
  const English_Desc = 'testing'
  const bilibiliURL = await getBiliBiliUrl(databaseId);
// when AI API is finished, update the Eng Name and decription
  await updateEnglish(English_Name, English_Desc);
  // Run the videoDownloader with the in progress data
  await VideoInput(English_Name, bilibiliURL);
  // if download success then update status to "Done"
  await UpdateStatus(uploadId);
// being upload onto youtube
  const uploadedYoutubeUrl = await uploadYoutubeVideo();
// if success then return the Youtube URL
  await updateYoutubeURL(uploadedYoutubeUrl)
  // set upload Date to the date
  await updateUploadDate();
   } catch (error) {
    console.log('Error in workflow:', error);
   }

   return executeWorkflow();
  }

// a successful upload would look like this

// the npm run dev will serve as a troubleshoot runs the same as above when button is pressed
   return (
    <div>
      {/* <GetTodayUpload /> */}
         {/* {response} */}
       {/* <Scraper /> */}
       {/* <VideoDownloader /> */}
    </div>
   )
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
