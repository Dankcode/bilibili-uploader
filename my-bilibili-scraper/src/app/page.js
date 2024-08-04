import React from 'react';
// import PostForm from './Form';
// import Scraper from './biliscraper';
// import VideoInput from './bilibili-downloader';
// import UsernameList from './NotionDB/getNotionData';
import uploadYoutubeVideo from './uploadYoutube';
// import { UpdateStatus, updateEnglish, updateYoutubeURL, updateUploadDate, UpdateCompleted } from './NotionDB/updateData';
// import { GetTodayUpload } from './NotionDB/updateData';
// import { getValidUpload, findInProgress } from './NotionDB/getValidUpload';
// import {getDatabaseData, getPageData} from './NotionDB/getNotionData'
// import getEnglishName from './aiStuff/getEnglish';
const { exec } = require('child_process');
const path = require('path');
const PYTHON_SCRIPT_PATH = path.join('@/bilibili-uploader', 'youtube_video_and_thumbnail_uploader');
export default function myPage() {


      const databaseId = '1fb726490c0947e9967a285846af19f5'
   try {
//     let notionDatabaseId= await getDatabaseData(databaseId)

//     // console.log('gott the notion db id' + notionDatabaseId)
// // first gets today's upload
//   await GetTodayUpload(notionDatabaseId, databaseId);
// // 2nd checks the notion DB for a valid upload with getValidUpload from getvalidupload.js to get the id of the upload
//   let uploadId = await getValidUpload(databaseId);
//   // console.log('uplaod id is' + uploadId)
// // change the selected table to In progress
//   await UpdateStatus(uploadId);
// // run the checker for In progress rows
//   let inProgressId = await findInProgress(databaseId);
//   // console.log('inprogres id ' + inProgressId)

//   const pageData = await getPageData(inProgressId)
//   const Chinese_Name = pageData.chinese_name;
//   const bilibiliURL = pageData.bilibiliUrl;
//   // console.log('chinese name' + Chinese_Name)
// // Run the AI API to get an Eng Desc and Eng Name
//   const English_Name = 'test'
//   // const English_Name = await getEnglishName(Chinese_Name)
//   const English_Desc = 'testing'
// // when AI API is finished, update the Eng Name and decription
//   await updateEnglish(inProgressId, English_Name, English_Desc);
//   // Run the videoDownloader with the in progress data
//   await VideoInput(English_Name, bilibiliURL);
//   // if download success then update status to "Done"
//   await UpdateCompleted(inProgressId);
// being upload onto youtube
  uploadYoutubeVideo('../my-bilibili-scraper/Videos/test.mp4', 'test', 'test desc');
// if success then return the Youtube URL
  // await updateYoutubeURL(inProgressId, uploadedYoutubeUrl)
  // // set upload Date to the date
  // await updateUploadDate(inProgressId);
   } catch (error) {
    console.log('Error in workflow:', error);
   }


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
