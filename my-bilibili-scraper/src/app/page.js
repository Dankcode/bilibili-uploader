"use client"

import React, { useState, useEffect }from 'react';
import UsernameList from './db';

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
    );
};

const createUser = (username) => {
  const [userURL, setURL] = useState('');
  const handleSubmit = (e) => {
    e.preventDefault();
    /*
    takes a URL and the scraper grabs the username's data to fill in the username role
    only accepts a proper bilibili url 
    */
  }
  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="username">Username:</label>
      <input type="text" id="username" value={username} onChange={(e) => setURL(e.target.value)} />
      <button type="submit">Add User</button>
    </form>
  );
}
export default TableList;