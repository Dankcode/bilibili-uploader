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
// 1. scrape the data from the list of video url pages and selects only the VALID videos to be uploaded
//     includes 15min length
const videoLengthChecker = (scrapedData) => {
  return scrapedData.filter((val) => {
    // Check if the object has a "length" property and convert it to minutes (assuming MM:SS format)
    if (val.length) {
      const minutes = parseInt(val.length.split(":")[0], 10);
      return minutes > 15;  // Only keep videos longer than 15 minutes
    } else {
      console.log('missing vid length, update error');
      return false;  // Exclude videos without length
    }
  });
};
// create a function to select for 15+ min video in the future
//     find key words
// create function to personally add new keywords 
//     make specific keyword search in video titles
const find_keywords = (checkedData, approvedKeywords) => {
  const keywordArray = approvedKeywords.map(keyword => keyword.toLowerCase()); // Convert all keywords to lowercase

  // Filter out items that don't include any of the approved keywords in their title
  const filteredArray = checkedData.filter((item) => {
    const lowerTitle = item.name.toLowerCase(); // Convert the title to lowercase for case-insensitive comparison
    return keywordArray.some((keyword) => lowerTitle.includes(keyword)); // Return true if any keyword is found
  });

  // Log and return the filtered list
  console.log("Filtered Array:", filteredArray);
  return filteredArray;
};
// 2. compare the data to the url links
const find_newUpload = (filteredScrapedData, previouslyUploadedURLs, baseUrl) => {
  const originalUrls = [...filteredScrapedData];

  // Find the first non-matching upload
  const firstNonMatchingUpload = originalUrls.find((val) => {
    return !previouslyUploadedURLs.includes(val.link);
  });

  // If no new uploads are found, move to the next page
  if (!firstNonMatchingUpload) {
    const nextPageUrl = moveToNextPage(baseUrl);
    console.log("No new uploads found. Moving to next page:", nextPageUrl);
    return { newUpload: null, nextPageUrl }; // Return both newUpload and nextPageUrl
  }

  // Returns the first non-matching upload or null if all videos are uploaded
  return { newUpload: firstNonMatchingUpload, nextPageUrl: null };
};

// Function to handle pagination when no new uploads are found
function moveToNextPage(baseUrl) {
  const queryString = "?tid=0&pn=1&keyword=&order=pubdate";
  if (baseUrl.includes("?")) {
    const urlObject = new URL(baseUrl); // Corrected from 'url' to 'baseUrl'
    const searchParams = urlObject.searchParams;
    const currentPage = parseInt(searchParams.get('pn'), 10) || 1;
    const nextPage = currentPage + 1;

    searchParams.set('pn', nextPage);
    urlObject.search = searchParams.toString();
    return urlObject.toString();
  } else {
    const fullUrl = baseUrl + queryString; // Append the query string directly
    console.log("Full URL (no existing query string):", fullUrl);
    return fullUrl;
  }
}
export {
  videoLengthChecker,
  find_keywords,
  find_newUpload,
}