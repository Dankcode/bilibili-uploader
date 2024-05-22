import mongoose from 'mongoose';

const MySchema = new mongoose.Schema({
  // Define your schema fields here
  Chinese_Name: 'string', //when updating the list every week, check the Chinese_Name for a match and append the ones that don't previously exist
  Chinese_Desc: 'string', //might return blank
  Eng_Name:'string', //generates the Eng name first before downloading
  Eng_Desc:'string', // can be generated before uploading
  BiliURL:'string', 
  Valid:'Boolean', //checks for the proper ASMR or chuimian keyword in Chinese_name 
  Downloaded:'Boolean', // searches the directory for the file name matching the Eng_Name
  Valid_Format:'Boolean', //checks to see if the file format is MP4
  Upload_Date: 'date', // set upload every week
  YoutubeURL: 'string',
});

export default mongoose.model('dataInfo', MySchema); // Replace with your desired model name