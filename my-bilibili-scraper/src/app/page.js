import React from 'react';
// import PostForm from './Form';
import Scraper from './biliscraper';
import VideoDownloader from './bilibili-downloader';
import UsernameList from './NotionDB/getUsernames';
import { QueryDatabase } from './NotionDB/updateData';
import { GetTodayUpload } from './NotionDB/updateData';
import { UpdateChinese } from './NotionDB/updateData';

export default function myPage() {
   const pageId = '9a51f3fc-e89d-40a1-a3f1-594278ad932f'; // Replace with your actual page ID
   const BiliURL = 'https://www.bilibili.com/video/BV1wz4y1F7Vc';
   const Chinese_Name = '示例名称'; // Example Chinese name
   const Chinese_Desc = '这是一个示例描述'; // Example Chinese description
 
   // const response = UpdateChinese(pageId, BiliURL, Chinese_Name, Chinese_Desc)
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
