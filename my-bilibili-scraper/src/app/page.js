import VideoInput from './bilibili-downloader';
import fs from 'fs';
import UploadVideo from './uploadYoutube';
import { UpdateStatus, updateEnglish, updateYoutubeURL, updateUploadDate, UpdateCompleted, getCurrentDate, UpdateError} from './NotionDB/updateData';
import { GetTodayUpload } from './NotionDB/updateData';
import { getValidUpload, findInProgress } from './NotionDB/getValidUpload';
import {getDatabaseData, getPageData} from './NotionDB/getNotionData'
import {getEnglishData} from './aiStuff/getEnglish';
import {removeVideoAudioMix, removeVideos} from './cleanFolder';

const fileExists = (filePath) => {
  return new Promise((resolve, reject) => {
    fs.access(filePath, fs.constants.F_OK, (err) => {
      if (err) {
        reject(new Error(`File not found: ${filePath}`));
      } else {
        resolve(true);
      }
    });
  });
};
export default function myPage() {
  const databaseId = '1fb726490c0947e9967a285846af19f5';
  const defaultDesc = 'Hi, my name is, nice to meet you! I\'m an ASMR artist and I hope you like it here ⸜(｡ &gt; ᵕ &lt; )⸝♡ An autonomous sensory meridian response (ASMR) is a tingling sensation that usually begins on the scalp and moves down the back of the neck and upper spine. A pleasant form of paresthesia, it has been compared with auditory-tactile synesthesia and may overlap with frisson. DISCLAIMER! The only purpose of my videos is to help you fall asleep and nothing more, let\'s respect each other and I\'m sure we\'ll become friends (づ๑•ᴗ•๑)づ♡'
  const executeWorkflow = async () => {
    try {
      const notionDatabaseId = await getDatabaseData(databaseId);
      
      // Check for uploadId first
      let uploadId = await getValidUpload(databaseId);
      if (uploadId) {
        // upload id is present, continue the upload 
        try {
        console.log('Upload ID found:', uploadId);
        await UpdateStatus(uploadId);
  
        const pageData = await getPageData(uploadId);
        const Chinese_Name = pageData.chinese_name;
        const bilibiliURL = pageData.bilibiliUrl;

        const getAiData = await getEnglishData(Chinese_Name, defaultDesc)
        const generatedData = JSON.parse(getAiData.toString())
        const English_Name = generatedData["Title"];
        const English_Desc = generatedData["Description"];
        const videoTags = `[${generatedData["Tags"].join(' ')}]`;
        const date = getCurrentDate();

        await updateEnglish(uploadId, English_Name, English_Desc);
        await VideoInput(date, bilibiliURL);
        await UpdateCompleted(uploadId);

        console.log('Beginning upload process...');
        const videoPath = `./Videos/${date}.mp4`;
        await fileExists(videoPath);
        const uploadedYoutubeUrl = await UploadVideo(videoPath, `${English_Name}`, `${English_Desc}`,`${videoTags}`);
        
        await updateYoutubeURL(uploadId, uploadedYoutubeUrl);

        await updateUploadDate(uploadId);
        } catch (error) {
          console.error('Error in workflow:', error);
          await UpdateError(uploadId, `Error in workflow: ${error.message}`); 
        }
      } else {
          // If neither uploadId nor inProgressId is found, execute the else branch
          try{
          console.log('Neither upload ID nor in-progress ID found. Running else branch...');
          
          await GetTodayUpload(notionDatabaseId, databaseId);
          uploadId = await getValidUpload(databaseId);
          await UpdateStatus(uploadId);
          
          const pageData = await getPageData(uploadId);
          const Chinese_Name = pageData.chinese_name;
          const bilibiliURL = pageData.bilibiliUrl;
          console.log('Chinese name:', Chinese_Name);
          
          const getAiData = await getEnglishData(Chinese_Name, defaultDesc)
          const generatedData = JSON.parse(getAiData.toString())
          const English_Name = generatedData["Title"];
          const English_Desc = generatedData["Description"];
          const videoTags = generatedData["Tags"].join(' ');
          const date = getCurrentDate();
  
          await updateEnglish(uploadId, English_Name, English_Desc);
          await VideoInput(date, bilibiliURL);
          await UpdateCompleted(uploadId);
  
          console.log('Beginning upload process...');
          const videoPath = `./Videos/${date}.mp4`;
          await fileExists(videoPath);
          const uploadedYoutubeUrl = await UploadVideo(videoPath, `${English_Name}`, `${English_Desc}`,`${videoTags}`);
          
          await updateYoutubeURL(uploadId, uploadedYoutubeUrl);

          await updateUploadDate(uploadId);
          } catch (error) {
            console.error('Error in workflow:', error);
            await UpdateError(uploadId, `Error in workflow: ${error.message}`);
          }
        }
    } catch (error) {
      console.error('Error in everything', error);
    }
    await removeVideoAudioMix();
    await removeVideos();
  };
  
  return executeWorkflow();
}
// ai test
/*
export default function myPage() {
  const databaseId = '1fb726490c0947e9967a285846af19f5';
  const executeWorkflow = async () => {
    try {
      const notionDatabaseId = await getDatabaseData(databaseId);
      
          const Chinese_Name = await GetTodayUpload(notionDatabaseId, databaseId);
          console.log('Chinese name:', Chinese_Name);
          
          const English_Name = await getEnglishName(Chinese_Name[0].title);
          console.log(English_Name)
    } catch (error) {
      console.error('Error in workflow:', error);
    }
  };
  
  return executeWorkflow();
}
*/