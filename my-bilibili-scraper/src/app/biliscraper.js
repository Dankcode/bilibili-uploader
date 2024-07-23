const puppeteer = require('puppeteer');

  export default async function Scraper(pageUrl) {
    // copy paste the video page URL, but do not replace the /video?tid=0&pn=3&keyword=&order=pubdate part 
    // the {pageNumber} value must be set for each new video
    // const bilibiliUrl = 'https://space.bilibili.com/49748554/video?tid=0&pn=1&keyword=&order=pubdate'; 
    // Replace with target URL make sure the video?tid=0&pn=1&keyword=&order=pubdate is added later
    const bilibiliUrl = pageUrl; 
    try {
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
  
      await page.goto(bilibiliUrl);
  
      // Wait for content to load (optional)
      await page.waitForSelector('body');
  
      // Execute Javascript to extract all anchor tags with href attribute
      //find video length and match it to said video
      const allALinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a.cover'));
        const lengths = Array.from(document.querySelectorAll('span.length'));
        const names = Array.from(document.querySelectorAll('a.title'));
        const mergedData = links.map((link, index) => {
          const lengthText = lengths[index] ? lengths[index].textContent : null; // Handle potential missing length
          const nameText = names[index] ? names[index].textContent : null; // Handle potential missing length
          return {
            name: nameText,
            link: link.href, // Reference to the original link element
            length: lengthText, // Extracted text content from corresponding length span
          };
        });
        return mergedData
        //cronjob sends array data to sql database then starts the upload progress
      });

      // return (
      //   <div>
      //     <h1>Bilibili Links</h1>
      //     <ul>
      //       {allALinks.map((url, index) => (
      //         <li key={index}>
      //           <p>{url.name}</p>
      //           <a href={url.link}>{url.link}</a> <p>{url.length}</p>
      //         </li>
      //       ))}
      //     </ul>
      //   </div>
      // );
      // console.log(allALinks)
      return allALinks
    } catch (error) {
      console.error('Error scraping data:', error);
      return <div>Error scraping data</div>;
    }
  }
