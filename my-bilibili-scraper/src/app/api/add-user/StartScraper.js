"use client"
import React, { useState }from 'react';

export const CreateUser = () => {
  const [userURL, setURL] = useState('');
  const [isValid, setIsValid] = useState(false);

  const handleChange = (e) => {
    setURL(e.target.value);
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    /*
    takes a URL and the scraper grabs the username's data to fill in the username role
    only accepts a proper bilibili url 
    */
    const regex = /bilibili\.com\/(\d+)/;

    const isValidUrl = regex.test(userURL);
    console.log(isValidUrl)
    setIsValid(isValidUrl);
  }


  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="username">Username:</label>
      <input type="text" id="username" value={userURL} onChange={handleChange} />
      <button type="submit">Add User</button>
      {isValid && 
        <p>
          Valid Bilibili URL!
          <button  /*onClick= start the scraper here*/> create new User</button>
        </p>}
      {!isValid && userURL && <p>Invalid Bilibili URL.</p>}
    </form>
  );
}

export default CreateUser
// import { sql } from '@vercel/postgres';
// import { NextResponse } from 'next/server';
 
// export async function GET(request) {
//   const { searchParams } = new URL(request.url);
//   const petName = searchParams.get('petName');
//   const ownerName = searchParams.get('ownerName');
 
//   try {
//     if (!petName || !ownerName) throw new Error('Pet and owner names required');
//     await sql`INSERT INTO Pets (Name, Owner) VALUES (${petName}, ${ownerName});`;
//   } catch (error) {
//     return NextResponse.json({ error }, { status: 500 });
//   }
 
//   const pets = await sql`SELECT * FROM Pets;`;
//   return NextResponse.json({ pets }, { status: 200 });
// }