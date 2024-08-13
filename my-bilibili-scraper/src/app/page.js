// import PostForm from './Form';
// import Scraper from './biliscraper';
// import VideoInput from './bilibili-downloader';
// import UsernameList from './NotionDB/getNotionData';
import UploadVideo from './uploadYoutube';
// import { UpdateStatus, updateEnglish, updateYoutubeURL, updateUploadDate, UpdateCompleted } from './NotionDB/updateData';
// import { GetTodayUpload } from './NotionDB/updateData';
// import { getValidUpload, findInProgress } from './NotionDB/getValidUpload';
// import {getDatabaseData, getPageData} from './NotionDB/getNotionData'
// import getEnglishName from './aiStuff/getEnglish';

export default function myPage() {
return (
   <UploadVideo videoPath='./my-bilibili-scraper/Videos/test.mp4' title='test' description='This is a description of my awesome video.'/>
)
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
