import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import Downloader from './downloader';

/**
 * Fetches the SESSDATA cookie from a Bilibili URL using Playwright.
 */
async function getSessData(bilibiliUrl) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    
    const storagePath = path.join(process.cwd(), 'config', 'storage.json');
    if (fs.existsSync(storagePath)) {
      const storage = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
      await context.addCookies(storage.cookies || []);
      // Add local storage if needed
    }

    const page = await context.newPage();
    await page.goto(bilibiliUrl, { waitUntil: 'domcontentloaded' });
    
    const cookies = await context.cookies();
    const sess = cookies.find(c => c.name === 'SESSDATA');
    
    return sess ? sess.value : null;
  } catch (error) {
    console.error('Bilibili Cookie Error:', error.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Parses the video info from the Bilibili page HTML.
 */
const parseVideoInfo = async (bilibiliUrl, sessData) => {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15';
  
  try {
    const config = {
      headers: {
        'User-Agent': UA,
        cookie: sessData ? `SESSDATA=${sessData}` : ''
      }
    };
    
    const { data: html } = await axios.get(bilibiliUrl, config);
    
    const initialStateMatch = html.match(/<\/script><script>window\.__INITIAL_STATE__=([\s\S]*?);\(function\(\)/);
    const playInfoMatch = html.match(/<script>window\.__playinfo__=([\s\S]*?)<\/script><script>window\.__INITIAL_STATE__=/);

    if (!initialStateMatch || !playInfoMatch) throw new Error('Could not find video data in HTML');

    const videoData = JSON.parse(initialStateMatch[1]).videoData;
    const playInfo = JSON.parse(playInfoMatch[1]);

    return {
      title: videoData.title,
      videoUrl: playInfo.data.dash.video[0].baseUrl,
      audioUrl: playInfo.data.dash.audio[0].baseUrl,
    };
  } catch (error) {
    console.error('Bilibili Parse Error:', error.message);
    throw error;
  }
};

/**
 * Main Bilibili entry point for getting info and starting download.
 */
export const processBilibiliUrl = async (videoName, bilibiliUrl, options = {}) => {
  try {
    console.log(`Processing Bilibili URL: ${bilibiliUrl}`);
    const sessData = await getSessData(bilibiliUrl);
    const info = await parseVideoInfo(bilibiliUrl, sessData);
    
    console.log(`Starting download for: ${info.title} (as ${videoName})`);
    return await Downloader(videoName, bilibiliUrl, info.videoUrl, info.audioUrl, options);
  } catch (error) {
    console.error('Bilibili Process Error:', error.message);
    throw error;
  }
};
