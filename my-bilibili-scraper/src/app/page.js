import VideoInput from './bilibili-downloader';
import fs from 'fs';
import UploadVideo from './uploadYoutube';
import { UpdateStatus, updateEnglish, updateYoutubeURL, updateUploadDate, UpdateCompleted, getCurrentDate, UpdateError} from './NotionDB/updateData';
import { GetTodayUpload } from './NotionDB/updateData';
import { getValidUpload, findInProgress } from './NotionDB/getValidUpload';
import {getDatabaseData, getPageData} from './NotionDB/getNotionData'
import getEnglishName from './aiStuff/getEnglish';
import {removeVideoAudioMix, removeVideos} from './cleanFolder';

const fileExists = (filePath) => {
  return new Promise((resolve, reject) => {
    fs.access(filePath, fs.constants.F_OK, (err) => {
      if (err) {
        reject(new Error(`File not found: ${filePath}`));
      } else {
        resolve(true);
      }
    });
  });
};
export default function myPage() {
  const databaseId = '1fb726490c0947e9967a285846af19f5';
  const executeWorkflow = async () => {
    try {
      const notionDatabaseId = await getDatabaseData(databaseId);
      
      // Check for uploadId first
      let uploadId = await getValidUpload(databaseId);
      if (uploadId) {
        console.log('Upload ID found:', uploadId);
        await UpdateStatus(uploadId);
  
        const pageData = await getPageData(uploadId);
        const Chinese_Name = pageData.chinese_name;
        const bilibiliURL = pageData.bilibiliUrl;
        console.log('Chinese name:', Chinese_Name);
        
        const English_Name = await getEnglishName(Chinese_Name);
        const English_Desc = 'testing';
        const date = getCurrentDate();
  
        await updateEnglish(uploadId, English_Name, English_Desc);
        await VideoInput(date, bilibiliURL);
        await UpdateCompleted(uploadId);
  
        console.log('Beginning upload process...');
        const videoPath = `./Videos/${date}.mp4`;
        await fileExists(videoPath);
        const uploadedYoutubeUrl = await UploadVideo(videoPath, `${English_Name}`, 'This is a description of my awesome video.');
        
        await updateYoutubeURL(uploadId, uploadedYoutubeUrl);
        await updateUploadDate(uploadId);
        removeVideoAudioMix();
        removeVideos();
      } else {
          // If neither uploadId nor inProgressId is found, execute the else branch
          console.log('Neither upload ID nor in-progress ID found. Running else branch...');
          
          await GetTodayUpload(notionDatabaseId, databaseId);
          uploadId = await getValidUpload(databaseId);
          await UpdateStatus(uploadId);
          
          const pageData = await getPageData(uploadId);
          const Chinese_Name = pageData.chinese_name;
          const bilibiliURL = pageData.bilibiliUrl;
          console.log('Chinese name:', Chinese_Name);
          
          const English_Name = await getEnglishName(Chinese_Name);
          const English_Desc = 'testing';
          const date = getCurrentDate();
  
          await updateEnglish(uploadId, English_Name, English_Desc);
          await VideoInput(date, bilibiliURL);
          await UpdateCompleted(uploadId);
  
          console.log('Beginning upload process...');
          const videoPath = `./Videos/${date}.mp4`;
          await fileExists(videoPath);
          const uploadedYoutubeUrl = await UploadVideo(videoPath, `${English_Name}`, 'This is a description of my awesome video.');
          
          await updateYoutubeURL(uploadId, uploadedYoutubeUrl);
          await updateUploadDate(uploadId);
          removeVideoAudioMix();
          removeVideos();
        }
    } catch (error) {
      console.error('Error in workflow:', error);
      if (uploadId) {
        await UpdateError(uploadId, `Error in workflow: ${error.message}`);
      }
    }
  };
  
  return executeWorkflow();
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
