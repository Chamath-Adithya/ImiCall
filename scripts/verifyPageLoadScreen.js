import puppeteer from 'puppeteer-core';

async function testPageLoadScreen() {
  console.log('🧪 Verifying that page load lands directly on the Phone Book & NOT the active call screen...');
  const CHROME_PATH = '/usr/bin/google-chrome';
  const URL = 'http://localhost:8080';

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--headless=new',
    ],
  });

  const page = await browser.newPage();

  try {
    console.log('📱 Opening application URL...');
    await page.goto(URL, { waitUntil: 'domcontentloaded' });

    // Wait 2 seconds to ensure any background connection setup finishes
    await new Promise((r) => setTimeout(r, 2000));

    // Check DOM state
    const state = await page.evaluate(() => {
      const activeCallContainer = document.querySelector('.call-active-container');
      const callActiveText = document.body.innerText.includes('Connecting Audio Channel...') ||
                             document.body.innerText.includes('Call Active');
      const hasPhoneBook = document.body.innerText.includes('Phone Book') ||
                           document.body.innerText.includes('Direct Hotline');
      const hasCallPartnerBtn = Array.from(document.querySelectorAll('button')).some(
        b => b.textContent && b.textContent.includes('Call Partner')
      );

      return {
        hasActiveCallContainer: !!activeCallContainer,
        callActiveText,
        hasPhoneBook,
        hasCallPartnerBtn,
      };
    });

    console.log('DOM State on Load:', state);

    if (state.hasActiveCallContainer || state.callActiveText) {
      throw new Error('FAIL: Screen prematurely rendered Active In-Call view on load!');
    }

    if (!state.hasPhoneBook || !state.hasCallPartnerBtn) {
      throw new Error('FAIL: Phone Book / Hotline dashboard was not rendered on load!');
    }

    console.log('✅ PASS: User cleanly landed on Phone Book / Hotline Dashboard on page load! No false call screen!');

    // Test a page refresh
    console.log('🔄 Refreshing page...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 2000));

    const refreshedState = await page.evaluate(() => {
      const activeCallContainer = document.querySelector('.call-active-container');
      const callActiveText = document.body.innerText.includes('Connecting Audio Channel...') ||
                             document.body.innerText.includes('Call Active');
      const hasCallPartnerBtn = Array.from(document.querySelectorAll('button')).some(
        b => b.textContent && b.textContent.includes('Call Partner')
      );

      return {
        hasActiveCallContainer: !!activeCallContainer,
        callActiveText,
        hasCallPartnerBtn,
      };
    });

    console.log('DOM State on Refresh:', refreshedState);

    if (refreshedState.hasActiveCallContainer || refreshedState.callActiveText) {
      throw new Error('FAIL: Screen prematurely rendered Active In-Call view on refresh!');
    }

    if (!refreshedState.hasCallPartnerBtn) {
      throw new Error('FAIL: Call Partner button not visible on refresh!');
    }

    console.log('✅ PASS: Page refresh also cleanly remains on Phone Book / Hotline Dashboard!');
  } finally {
    await browser.close();
  }
}

testPageLoadScreen()
  .then(() => console.log('🎉 100% Page Load Verification PASSED!'))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
