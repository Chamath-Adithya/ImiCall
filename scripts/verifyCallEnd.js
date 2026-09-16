import puppeteer from 'puppeteer-core';

async function testCallEndReturnToMain() {
  console.log('🧪 Verifying that Ending Call immediately returns the other peer to the main hotline page...');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/google-chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files',
    ],
  });

  const page1 = await browser.newPage();
  const page2 = await browser.newPage();

  const testLine = 'test-line-end-' + Date.now();
  const url = `http://localhost:8080/#line=${testLine}&pin=2023`;

  try {
    await page1.goto(url, { waitUntil: 'domcontentloaded' });
    await page2.goto(url, { waitUntil: 'domcontentloaded' });

    await page1.waitForSelector('button.btn-primary');
    await page2.waitForSelector('button.btn-primary');

    console.log('📞 Peer 1 dialing Peer 2...');
    const callBtns1 = await page1.$$('button.btn-primary');
    for (const btn of callBtns1) {
      const text = await page1.evaluate((el) => el.textContent, btn);
      if (text && text.includes('Call Partner')) {
        await btn.click();
        break;
      }
    }

    console.log('⏳ Waiting for Peer 2 incoming call modal...');
    await page2.waitForSelector('.modal-card');

    const answerBtn = await page2.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find((b) => b.textContent && b.textContent.includes('Answer'));
    });
    if (answerBtn) {
      await answerBtn.click();
    }

    console.log('⏳ Waiting for active call screen on both peers...');
    await page1.waitForSelector('.call-actions-bar', { timeout: 10000 });
    await page2.waitForSelector('.call-actions-bar', { timeout: 10000 });
    console.log('✅ Both peers are in active call!');

    // Now Peer 1 clicks "End Call"
    console.log('🛑 Peer 1 clicking End Call button...');
    const endCallBtn1 = await page1.waitForSelector('button[title="End Call"]');
    await endCallBtn1.click();

    // Verify Peer 1 returned to main page with "Call Partner" button
    console.log('⏳ Checking Peer 1 returned to main hotline page...');
    await page1.waitForFunction(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some((b) => b.textContent && b.textContent.includes('Call Partner'));
    }, { timeout: 6000 });
    console.log('✅ Peer 1 successfully returned to main hotline page!');

    // Verify Peer 2 ALSO returned to main page with "Call Partner" button!
    console.log('⏳ Checking Peer 2 automatically returned to main hotline page...');
    await page2.waitForFunction(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some((b) => b.textContent && b.textContent.includes('Call Partner'));
    }, { timeout: 6000 });
    console.log('✅ Peer 2 successfully returned to main hotline page automatically! No empty screen!');

    console.log('🎉 100% Call End Teardown & Return to Main Page VERIFIED!');
  } finally {
    await browser.close();
  }
}

testCallEndReturnToMain().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
