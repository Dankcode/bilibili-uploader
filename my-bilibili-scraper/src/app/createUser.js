// "use client"
// import React, { useState }from 'react';

// export const CreateUser = () => {
//   const [userURL, setURL] = useState('');
//   const [isValid, setIsValid] = useState(false);

//   const handleChange = (e) => {
//     setURL(e.target.value);
//   };
//   const handleSubmit = (e) => {
//     e.preventDefault();
//     /*
//     takes a URL and the scraper grabs the username's data to fill in the username role
//     only accepts a proper bilibili url 
//     call the post(username), post(chinese_name) etc
//     */
//     const regex = /bilibili\.com\/(\d+)/;

//     const isValidUrl = regex.test(userURL);
//     console.log(isValidUrl)
//     setIsValid(isValidUrl);
//   }


//   return (
//     <form onSubmit={handleSubmit}>
//       <label htmlFor="username">Username:</label>
//       <input type="text" id="username" value={userURL} onChange={handleChange} />
//       <button type="submit">Add User</button>
//       {isValid && 
//         <p>
//           Valid Bilibili URL!
//           <button  /*onClick= start the scraper here*/> create new User</button>
//         </p>}
//       {!isValid && userURL && <p>Invalid Bilibili URL.</p>}
//     </form>
//   );
// }

// export default CreateUser