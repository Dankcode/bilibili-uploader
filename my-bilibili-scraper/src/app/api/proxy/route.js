import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer';

export async function POST(req) {
  try {
    // Extract pageUrl from the request body (assuming it's a POST request)
    const { pageUrl } = await req.json();

    if (!pageUrl) {
      return NextResponse.json({ error: 'Page URL is required' }, { status: 400 });
    }

    // Launch Puppeteer
    const browser = await puppeteer.launch({
      headless: true, // Headless mode (no GUI)
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Required for deployment environments like Vercel
    });
    const page = await browser.newPage();

    // Navigate to the provided URL
    await page.goto(pageUrl);

    // Wait for the necessary elements to load
    await page.waitForSelector('body');

    // Scrape the data from the page (video titles, links, and lengths)
    const scrapedData = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a.cover'));
      const lengths = Array.from(document.querySelectorAll('span.length'));
      const names = Array.from(document.querySelectorAll('a.title'));

      return links.map((link, index) => {
        const lengthText = lengths[index] ? lengths[index].textContent : null;
        const nameText = names[index] ? names[index].textContent : null;
        return {
          name: nameText,
          link: link.href,
          length: lengthText,
        };
      });
    });

    // Close the browser after scraping
    await browser.close();

    // Return the scraped data as JSON
    return NextResponse.json({ data: scrapedData }, { status: 200 });

  } catch (error) {
    console.error('Error scraping data:', error);
    return NextResponse.json({ error: 'Error scraping data' }, { status: 500 });
  }
}
