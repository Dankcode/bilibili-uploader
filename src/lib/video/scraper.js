import { chromium } from 'playwright';

/**
 * Scrapes a Bilibili space page for video links, names, and lengths.
 */
export default async function Scraper(pageUrl) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Set viewport for consistent results
    await page.setViewportSize({ width: 1280, height: 800 });
    
    console.log(`Navigating to Bilibili: ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for the main content to load
    await page.waitForSelector('a.cover', { timeout: 10000 });

    const mergedData = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a.cover'));
      const lengths = Array.from(document.querySelectorAll('span.length'));
      const names = Array.from(document.querySelectorAll('a.title'));
      
      return links.map((link, index) => ({
        name: names[index] ? names[index].textContent.trim() : 'Unknown Name',
        link: link.href,
        length: lengths[index] ? lengths[index].textContent.trim() : '00:00',
      }));
    });

    console.log(`Found ${mergedData.length} videos on the page.`);
    return mergedData;

  } catch (error) {
    console.error('Scraping Error:', error.message);
    throw new Error(`Failed to scrape Bilibili: ${error.message}`);
  } finally {
    if (browser) await browser.close();
  }
}
