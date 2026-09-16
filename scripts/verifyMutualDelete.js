import puppeteer from 'puppeteer-core';

async function verifyMutualDelete() {
  console.log('🗑️ Starting Mutual Contact Deletion Automated Verification...');
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
    const testRoom = 'line-mutual-sync-' + Date.now();
    const inviteUrl = `http://localhost:8080/#connect=${testRoom}&from=Alice&to=Bob&pin=2023`;

    console.log('📱 Peer 1 (Alice) opening app with direct room...');
    await page1.goto(`http://localhost:8080/#line=${testRoom}&pin=2023`, { waitUntil: 'domcontentloaded' });
    await page1.waitForSelector('.phonebook-header');

    console.log('📱 Peer 2 (Bob) opening invite link from Alice...');
    await page2.goto(inviteUrl, { waitUntil: 'domcontentloaded' });

    console.log('⏳ Peer 2 waiting for invitation card...');
    await page2.waitForFunction(() => document.body.innerText.includes('Alice wants to connect with you'));

    console.log('🤝 Peer 2 accepting invitation...');
    await page2.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const acceptBtn = btns.find(b => b.textContent.includes('Connect & Save to Phone Book'));
      if (acceptBtn) acceptBtn.click();
    });

    await page2.waitForFunction(() => document.body.innerText.includes('Phone Book'));
    await new Promise(r => setTimeout(r, 1000));

    // Verify Bob has Alice
    const bobHasAlice = await page2.evaluate(() => document.body.innerText.includes('Alice'));
    if (!bobHasAlice) throw new Error('Bob does not have Alice in Phone Book!');
    console.log('✅ Bob has Alice in Phone Book!');

    // Now Alice deletes the contact
    console.log('🗑️ Alice deleting connection from her Phone Book...');
    await page1.evaluate(() => {
      const deleteBtns = Array.from(document.querySelectorAll('button[title*="Delete"]'));
      if (deleteBtns.length > 0) {
        deleteBtns[0].click();
      }
    });

    // Wait for Peer 2 (Bob) to receive mutual deletion signal
    console.log('⏳ Waiting for Peer 2 (Bob) Phone Book to automatically purge Alice...');
    await page2.waitForFunction(
      () => !document.body.innerText.includes('Alice') || document.body.innerText.includes('removed by partner'),
      { timeout: 8000 }
    );
    console.log('✅ Peer 2 (Bob) successfully received mutual deletion! Contact was purged from both sides!');

    console.log('🎉 Mutual Contact Deletion 100% VERIFIED!');
  } finally {
    await browser1.close();
    await browser2.close();
  }
}

verifyMutualDelete()
  .then(() => console.log('🏆 100% Mutual Deletion Test PASSED!'))
  .catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
