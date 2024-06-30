import axios from 'axios';
import Cors from 'cors';

// Initialize the cors middleware
// const cors = Cors({
//   methods: ['GET', 'HEAD'],
//   origin: '*' // Adjust this to your needs, e.g., specific domains
// });

// // Helper method to wait for a middleware to execute before continuing
// // And to throw an error when an error happens in a middleware
// function runMiddleware(req, res, fn) {
//   return new Promise((resolve, reject) => {
//     fn(req, res, (result) => {
//       if (result instanceof Error) {
//         return reject(result);
//       }
//       return resolve(result);
//     });
//   });
// }

// export default async function handler(req, res) {
//   // Run the middleware
//   await runMiddleware(req, res, cors);

//   // Your logic here, for example, proxying a request to an external API
//   try {
//     const { url, headers } = req.query;
//     const { data } = await axios.get(url, { headers });
//     res.status(200).json(data);
//   } catch (error) {
//     res.status(500).json({ error: 'Failed to fetch data' });
//   }
// }
