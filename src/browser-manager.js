// Manages Puppeteer browser instances, page navigation, and CDP sessions.
const puppeteer = require('puppeteer');

/**
 * Launches the browser, navigates to the viewer and target URL, and connects DevTools.
 * @param {object} config - The application configuration object.
 * @returns {Promise<{browser: object, reportViewerPage: object, gamePage: object, cdpSession: object}>} 
 *          - A promise resolving to an object containing the browser instance,
 *            viewer page, game page, and CDP session.
 * @throws {Error} - Propagates errors from Puppeteer launch or navigation.
 */
async function initializeBrowser(config) {
    let browser = null;
    let reportViewerPage = null;
    let gamePage = null;
    let cdpSession = null;

    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({ 
            headless: config.isHeadless,
            defaultViewport: null,
        });

        // Navigate the initial tab to the report viewer
        const initialPages = await browser.pages();
        reportViewerPage = initialPages.length > 0 ? initialPages[0] : await browser.newPage(); // Reuse or create
        try {
            await reportViewerPage.goto(`http://localhost:${config.serverPort}`, { waitUntil: 'networkidle0' });
        } catch (viewerNavError) {
             console.warn(`Warning: Failed to navigate initial tab to report viewer: ${viewerNavError.message}. Continuing...`);
             // Continue execution even if the viewer fails to load initially
        }

        // Create and navigate a new page for the target game/app
        gamePage = await browser.newPage();
        await gamePage.goto(config.targetUrl, { waitUntil: 'networkidle0' }); 
        console.log('Game page loaded successfully.');

        // Connect to DevTools on the game page
        cdpSession = await gamePage.target().createCDPSession();
        await cdpSession.send('HeapProfiler.enable');

        return { browser, reportViewerPage, gamePage, cdpSession };

    } catch (error) {
        console.error('Error during browser initialization or navigation:', error.message);
        // Attempt cleanup if partially initialized
        if (browser) {
            await closeBrowser(browser); 
        }
        throw error; // Re-throw the error to be handled by the caller
    }
}

/**
 * Closes the Puppeteer browser instance.
 * @param {object} browser - The Puppeteer browser instance.
 * @returns {Promise<void>}
 */
async function closeBrowser(browser) {
    if (browser) {
        try {
            console.log('Closing browser...');
            await browser.close();
            console.log('Browser closed.');
        } catch (closeError) {
            console.error('Error closing browser:', closeError.message);
        }
    }
}

module.exports = { initializeBrowser, closeBrowser };
