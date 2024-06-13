"use client"
// import React from 'react';
// import PostForm from './Form';
// import Scraper from './biliscraper';

// export default function myPage() {
//   return (
//     <div>
//       <Scraper />
//     </div>
//   )
// }
/*
make a new button function where it checks for status that are not 'complete'
*/

import React, { useState, useEffect }from 'react';
import UsernameList from './postgreSQL-stuff/getUsernames';
import getAllData from './postgreSQL-stuff/getAllData';

const TableList = () => {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    async function fetchData() {
        const retrievedUsers = UsernameList();
        setUsers(retrievedUsers);
    };
    fetchData();
  },[users]);

  console.log(users)
  return (
    <div>
      <ul>
          <h1>Tables for Users</h1>
          {users.length > 0 ? (
            <ul>
              {users.map((val, index) => (
                <li key={index} onClick={(e) => {getAllData(val)}}>
                  {val}
                </li>
              ))}
            </ul>
          ) : (
            <p>No tables found for users.</p>
          )}
      </ul>
    </div>
    );
};


export default TableList;
