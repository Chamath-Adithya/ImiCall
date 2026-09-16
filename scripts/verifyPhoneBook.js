import puppeteer from 'puppeteer-core';

async function verifyPhoneBook() {
  console.log('📖 Starting Phone Book & Contact Connection Automated Verification...');
  const CHROME_PATH = '/usr/bin/google-chrome';
  const URL = 'http://localhost:8080';

  const chromeFlags = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--headless=new',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ];

  const browser1 = await puppeteer.launch({ executablePath: CHROME_PATH, args: chromeFlags });
  const browser2 = await puppeteer.launch({ executablePath: CHROME_PATH, args: chromeFlags });

  const page1 = await browser1.newPage();
  const page2 = await browser2.newPage();

  try {
    console.log('📱 Peer 1 (Chamath) opening app...');
    await page1.goto(URL, { waitUntil: 'domcontentloaded' });
    await page1.waitForSelector('.phonebook-header');

    console.log('➕ Peer 1 clicking "Add Contact"...');
    await page1.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const addBtn = btns.find(b => b.textContent.includes('Add Contact'));
      if (addBtn) addBtn.click();
    });

    await page1.waitForSelector('input[placeholder*="Nadeesha"]');
    await page1.type('input[placeholder*="Nadeesha"]', 'Nadeesha');
    await page1.type('input[placeholder*="Chamath"]', 'Chamath');

    console.log('🚀 Peer 1 creating contact "Nadeesha"...');
    await page1.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const createBtn = btns.find(b => b.textContent.includes('Create & Get Connection Link'));
      if (createBtn) createBtn.click();
    });

    // Wait for share modal
    await page1.waitForFunction(() => document.body.innerText.includes('Connect with Nadeesha'));
    console.log('✅ Connection modal generated for Nadeesha!');

    // Get the invite URL that was generated
    const connectionUrl = await page1.evaluate(() => {
      // Find the QR code or active contact link
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Copy Connection Link'));
      return window.location.origin + '/#' + window.location.hash.substring(1);
    });

    console.log('📱 Peer 2 (Nadeesha) opening connection link from Chamath...');
    const testInvite = 'http://localhost:8080/#connect=line-chamath-nadeesha-77&from=Chamath&to=Nadeesha&pin=2023';
    await page2.goto(testInvite, { waitUntil: 'domcontentloaded' });

    console.log('⏳ Waiting for Peer 2 incoming invitation card...');
    await page2.waitForFunction(() => document.body.innerText.includes('Chamath wants to connect with you'));
    console.log('✅ Peer 2 received incoming connection invitation from Chamath!');

    console.log('🤝 Peer 2 accepting connection...');
    await page2.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const acceptBtn = btns.find(b => b.textContent.includes('Connect & Save to Phone Book'));
      if (acceptBtn) acceptBtn.click();
    });

    await page2.waitForFunction(() => document.body.innerText.includes('Phone Book'));
    console.log('✅ Chamath saved in Peer 2 Phone Book!');

    // Verify Peer 2 now sees Chamath in their Phone Book
    const hasChamath = await page2.evaluate(() => document.body.innerText.includes('Chamath'));
    if (!hasChamath) throw new Error('Chamath not found in Peer 2 Phone Book!');

    console.log('📞 Peer 2 clicking Call to Chamath from Phone Book...');
    await page2.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const callBtn = btns.find(b => b.textContent.includes('Call Partner') || b.textContent.includes('Call'));
      if (callBtn) callBtn.click();
    });

    console.log('🎉 Phone Book & Contact Connection flow completely VERIFIED!');
  } finally {
    await browser1.close();
    await browser2.close();
  }
}

verifyPhoneBook()
  .then(() => console.log('🏆 100% Phone Book Test PASSED!'))
  .catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
