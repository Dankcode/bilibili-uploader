const { chromium } = require('playwright');
const fs = require('fs');

async function loginSimulation() {
  try {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
  
    // Navigate to the login page
    await page.goto('https://www.bilibili.com/video/BV1wz4y1F7Vc');
  
    console.log('Please log in manually...');
  
    // Wait for the user to complete the login
    await page.waitForTimeout(30000); // Adjust this time as needed for manual login
  
    // Save cookies and local storage to a file
    const storage = {
      cookies: await context.cookies(),
      localStorage: await page.evaluate(() => {
        const json = {};
        for (const [key, value] of Object.entries(window.localStorage)) {
          json[key] = value;
        }
        return json;
      }),
    };
    fs.writeFileSync('storage.json', JSON.stringify(storage, null, 2));
  
    console.log('Login state saved.');
  
    await browser.close();
  } catch(error) {
    console.log('Error', error);
  };
}
export default loginSimulation()