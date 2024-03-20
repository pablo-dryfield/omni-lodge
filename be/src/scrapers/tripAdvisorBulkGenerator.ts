import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
const __dirname = 'C:\\Users\\Pablo\\Desktop\\';

// Helper function to append reviews to a JSON file or create it if it doesn't exist
const appendReviewsToFile = (reviews: any[], filename: string) => {
  let existingReviews = [];
  if (fs.existsSync(filename)) {
    const data = fs.readFileSync(filename, { encoding: 'utf8' });
    existingReviews = JSON.parse(data);
  }
  const updatedReviews = existingReviews.concat(reviews);
  fs.writeFileSync(filename, JSON.stringify(updatedReviews, null, 2), { encoding: 'utf8' });
  console.log(`Appended reviews to ${filename}`);
};

export const scrapeTripAdvisor = async (start: number, end: number): Promise<void> => {
  const baseUrl = 'https://www.tripadvisor.com/AttractionProductReview-g274772-d13998447';
  const product = 'Pub_Crawl_Krawl_Through_Krakow-Krakow_Lesser_Poland_Province_Southern_Poland.html';
  const filename = path.join(__dirname, 'tripadvisor.json');

  const browser = await puppeteer.launch();

  for (let i = start; i <= end; i += 10) {
    const pageUrl = i === 0 ? `${baseUrl}-${product}` : `${baseUrl}-or${i}-${product}`;
    console.log(`Starting to process: ${pageUrl}`);

    const page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 0 });

    try {
      await page.waitForSelector('div[data-automation="reviewCard"]', { timeout: 0 });

      const reviews = await page.evaluate(() => {
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
            channel: 'Tripadvisor',
            name,
            title,
            description,
            score,
            date
          });
        });
        return extractedReviews;
      });

      // Append reviews to file after finishing processing each page
      appendReviewsToFile(reviews, filename);
      console.log(`Finished processing and saved reviews from: ${pageUrl}`);
    } catch (error) {
      console.error('Error during scraping:', error);
    }

    await page.close();
  }

  await browser.close();
};

