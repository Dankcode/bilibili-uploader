const puppeteer = require('puppeteer');

  export default async function Scraper() {
    // copy paste the video page URL, but do not replace the /video?tid=0&pn=3&keyword=&order=pubdate part 
    // the {pageNumber} value must be set for each new video
    const bilibiliUrl = 'https://space.bilibili.com/49748554/video?tid=0&pn=1&keyword=&order=pubdate'; // Replace with target URL
  
    try {
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
  
      await page.goto(bilibiliUrl);
  
      // Wait for content to load (optional)
      await page.waitForSelector('body');
  
      // Execute Javascript to extract all anchor tags with href attribute
      const allALinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href].title'));
        return links.map(link => link.href);
      });

      return (
        <div>
          <h1>Bilibili Links</h1>
          <ul>
            {allALinks.map((url, index) => (
              <li key={index}>
                <a href={url}>{url}</a>
              </li>
            ))}
          </ul>
        </div>
      );
    } catch (error) {
      console.error('Error scraping data:', error);
      return <div>Error scraping data</div>;
    }
  }
