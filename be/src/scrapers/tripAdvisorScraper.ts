import puppeteer from 'puppeteer';

export const scrapeTripAdvisor = async (url:string): Promise<any[]> => {
  const browser = await puppeteer.launch(); 
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 0  });

  let reviewsFinal: any[] = [];

  try {
    await page.waitForSelector('div[data-automation="reviewCard"]', { timeout: 0 });

    reviewsFinal = await page.evaluate(() => {
      const extractedReviews: any[] = [];
      const reviewElements = document.querySelectorAll('div[data-automation="reviewCard"]');
      reviewElements.forEach((reviewElement) => {
        const name = reviewElement.querySelector('.biGQs._P.fiohW.fOtGX a')?.textContent?.trim() ?? '';
        const title = reviewElement.querySelector('.biGQs._P.fiohW.qWPrE.ncFvv.fOtGX a .yCeTE')?.textContent?.trim() ?? '';
        const description = reviewElement.querySelector('.biGQs._P.pZUbB.KxBGd .JguWG .yCeTE')?.textContent?.trim() ?? '';
        const scoreSvg = reviewElement.querySelector('.UctUV');
        const scoreLabel = scoreSvg ? (scoreSvg.getAttribute('aria-label') || scoreSvg.querySelector('title')?.textContent) : '';
        const scoreMatch = scoreLabel ? scoreLabel.match(/(\d+\.?\d?)/) : null;
        const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
        const dateText = reviewElement.querySelector('.biGQs._P.pZUbB.ncFvv.osNWb')?.textContent?.trim() ?? '';
        const date = dateText ? new Date(dateText.replace('Written ', '')).toISOString().slice(0, 10) : '';
        extractedReviews.push({
          channel:'Tripadvisor',
          name,
          title,
          description,
          score,
          date
        });
      });
      return extractedReviews;
    });
    
  } catch (error) {
    console.error('Error during scraping:', error);
  }

  await browser.close();
  return reviewsFinal;
};
