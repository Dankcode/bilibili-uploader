"use client"

import React, { useState, useEffect }from 'react';
import UsernameList from './db';
import CreateUser from './api/add-user/StartScraper';

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
                <li key={index} onClick={(e) => {/* sends the username to the db.js */}}>
                  {val}
                </li>
              ))}
            </ul>
          ) : (
            <p>No tables found for users.</p>
          )}
      </ul>
    <CreateUser />
    </div>
    );
};


export default TableList;