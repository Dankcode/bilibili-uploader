import { google } from "googleapis";

export async function GetSheetData() {
  try {
    const credentials = require('./sheets.json'); // Replace with your credentials path
    const scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly']; // Adjust scopes if needed
    const jwt = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      scopes
    );
  
    const sheets = google.sheets({ version: 'v4', auth: jwt });
    const range = 'Sheet1!A1:B2';
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range,
    });

    console.log(response.data.values); // Log successful response data
    return( 
    <div>
      {response.data.values[0]}
    </div> 
    )// Optionally return the data
  } catch (error) {
    console.error('Error fetching sheet data:', error);
    // Handle the error here (e.g., return an empty array, display an error message)
    return []; // Example: return an empty array on error
  }
}
// export async function appendDataToSheet(data) {
//   const client = await getClient();
//   const spreadsheetId = process.env.SHEET_ID;
//   const valueRange = { values: [data] }; // Adjust data format as needed
//   fetch('https://script.google.com/macros/s/AKfycbwUBqCcvH2F7XKCsh8TcEbkvfqDj_HpHZd8XrZbIZWe08qoBOdaq8BSrfHsSt7VHPrz2w/exec', {
//     method: 'POST',
//     body: formData,
//   })
//   await client.spreadsheets.values.append({
//     spreadsheetId,
//     range: 'Sheet1!A:Z', // Adjust range as needed
//     valueInputOption: 'USER_ENTERED', // Adjust based on data format
//     insertDataOption: 'INSERT_ROWS', // Adjust based on insertion strategy
//     body: valueRange,
//   });
// }