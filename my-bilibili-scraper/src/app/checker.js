/* 
when cron queues the JS it will first
1. scrape the data from the list of video url pages and selects only the VALID videos to be uploaded
    includes 15min length
    find key words
    make specific keyword search in video titles
2. compare the data to the url links
3. if video matches title
    skips to the next in the list
    if entire page is in the list skip to the next page by changing the url page # to 2 and rescrape the data 
4. if video is not matched with in the db 
    upload "video found" status to SQL
    begin ai translation of the title
    generate ai recommended tags for the video
    once AI finishes
    upload "titles generated"status to SQL
    download video using the scraped URL
    once DLd
    upload "video downloaded"status to SQL
    the youtube auto uploader must find which API key to use to upload
    begin uploading python script
    upload "uploading"status to SQL
    once completed dump the given info for that video
    upload "completed" status to SQL
*/
import React from 'react';
import Scraper from './biliscraper';

// 1. scrape the data from the list of video url pages and selects only the VALID videos to be uploaded
//     includes 15min length
const videoLengthChecker = (scrapedData) => {
    const overFifteen = [...scrapedData]
    overFifteen.map((val, index) => {
        // Check if the object has a "length" property and convert it to minutes (assuming MM:SS format)
        if (val.length) {
          const minutes = parseInt(val.length.split(":")[0], 10);
          if (minutes > 15) {
            overFifteen.splice(index, 1); 
          }
          return val;
        }
        return console.log('missing vid length, update error');
      });
    return overFifteen
}
// create a function to select for 15+ min video in the future
//     find key words
// create function to personally add new keywords 
//     make specific keyword search in video titles
const find_keywords = (checkedData, approvedKeywords) => {
    const originalArray = [...checkedData];
    const keywordArray = [...approvedKeywords];
    // let filteredArray = []; // Initialize an empty array

    originalArray.map((val, index) => {
      const lowerTitle = val.name.toLowerCase(); // Convert title to lowercase for case-insensitive matching
      const hasKeyword = keywordArray.some((keyword) => lowerTitle.includes(keyword));
    
      if (!hasKeyword) {
        // filteredArray.unshift(item); // Add item to the beginning of filteredArray (efficient for prepend)
        originalArray.splice(index, 1); // Remove the item from originalArray
      } else {
        return val
      }
    });
    //only need to return the filtered list
    console.log("Original Array:", originalArray);
    return originalArray
}
// 2. compare the data to the url links
const find_newUpload = (filteredScrapedData, previouslyUploadedURLs) => {
    const originalUrls = [...filteredScrapedData];
    const comparedUrls = [...previouslyUploadedURLs];

    let firstNonMatchingUpload = null; // Initialize a variable to store the first non-matching URL

    originalUrls.map((val) => {
      const isMatch = comparedUrls.includes(val.link);
    
      if (!isMatch && firstNonMatchingUpload === null) {
        firstNonMatchingUpload = val;
      }
    });
    
    console.log("Original URLs (Modified - Optional Splicing):", originalUrls);
    console.log("First Non-Matching Upload:", firstNonMatchingUpload);
    // returns the name, link, and length for the soon-to-be-uploaded vod
    return firstNonMatchingUpload
    // if returns null then the entire page has been uploaded
}
// 3. if video matches title
//     skips to the next in the list
//     if entire page is in the list skip to the next page by changing the url page # to 2 
function moveToNextPage (baseUrl) {
    // base url will come in as 'https://space.bilibili.com/49748554/video?tid=0&pn=1&keyword=&order=pubdate' or 'https://space.bilibili.com/49748554/video'
    //"?tid=0&pn=1&keyword=&order=pubdate" is what appends to the end 
    //pn=1 is the page number
    //if the page is already uploaded, either append the querystring or add 1 to the previous
    const queryString = "?tid=0&pn=1&keyword=&order=pubdate";
    if (baseUrl.includes("?")) {
        const urlObject = new URL(url);
        const searchParams = urlObject.searchParams;
        const currentPage = parseInt(searchParams.get('pn'), 10);
        const nextPage = currentPage + 1;

        searchParams.set('pn', nextPage);
        urlObject.search = searchParams.toString();
        return urlObject.toString();
      } else {
        const fullUrl = baseUrl + "?tid=0&pn=1&keyword=&order=pubdate"; // Append the query string directly
        console.log("Full URL (no existing query string):", fullUrl);
        return fullUrl
      }
}