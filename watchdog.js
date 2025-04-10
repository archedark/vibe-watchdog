// const puppeteer = require('puppeteer'); // Moved to browser-manager
const getConfig = require('./src/config.js');
const ReportManager = require('./src/report-manager.js');
const serverManager = require('./src/server.js');
const { analyzeSnapshot } = require('./src/analyzer.js');
const { takeSnapshot } = require('./src/snapshotter.js');
const browserManager = require('./src/browser-manager.js'); // Require browser manager
const path = require('path');

// --- Run the watchdog ---
async function runWatchdog() {
    const config = getConfig();
    const reportManager = new ReportManager(__dirname);

    console.log(`Starting Watchdog for URL: ${config.targetUrl}`);
    console.log(`Headless mode: ${config.isHeadless}`);
    console.log(`Snapshot interval: ${config.interval}ms`);
    console.log(`Leak threshold: ${config.threshold} increases`);
    console.log(`Maximum reports to keep: ${config.maxReports}`); // Log the max reports value
    console.log(`Report viewer server starting on port: ${config.serverPort}`); // Log server port
    console.warn('Watchdog started. Using simplified analysis for MVP - results may be inaccurate.');

    let server = null; // Initialize server to null
    let browser = null; // Initialize browser to null
    let intervalId = null; // Initialize intervalId to null
    // Remove gamePage, cdpSession declarations here, they are returned by initializeBrowser

    try {
        // --- Initialize Report Directory ---
        await reportManager.initializeDirectory();

        // --- Clear Reports Logic ---
        if (config.clearReports) {
            console.log('--clear-reports flag detected.');
            await reportManager.clearReports();
        }

        // --- Start the Server ---
        server = serverManager.startServer(config, reportManager, __dirname);

        // --- Initialize Browser and Pages ---
        const { 
            browser: browserInstance, 
            // reportViewerPage, // Not directly used after init currently
            gamePage, 
            cdpSession 
        } = await browserManager.initializeBrowser(config);
        browser = browserInstance; // Assign to the function-scoped variable for cleanup
        
        // --- Remove Browser Launch Logic --- 
        // browser = await puppeteer.launch({...});
        // --- Remove Page Creation/Navigation Logic ---
        // const initialPages = await browser.pages();
        // reportViewerPage = ... await browser.newPage();
        // await reportViewerPage.goto(...);
        // gamePage = await browser.newPage();
        // await gamePage.goto(...);
        // --- Remove CDP Session Creation/Enabling --- 
        // cdpSession = await gamePage.target().createCDPSession();
        // await cdpSession.send('HeapProfiler.enable');

        // --- Snapshotter (takeSnapshot) and Analyzer (analyzeSnapshot) --- 
        // --- use the cdpSession returned from initializeBrowser ---

        // --- RE-ADD calculateConstructorDelta function --- 
        // Kept here for now as it depends on the analysis structure
        function calculateConstructorDelta(current, previous) {
            const delta = { threejs: {}, game: {}, misc: {} };
            const categories = ['threejs', 'game', 'misc'];

            for (const category of categories) {
                const currentCounts = current?.[category] || {};
                const previousCounts = previous?.[category] || {};
                const allKeys = new Set([...Object.keys(currentCounts), ...Object.keys(previousCounts)]);

                for (const key of allKeys) {
                    const currentVal = currentCounts[key] || 0;
                    const previousVal = previousCounts[key] || 0;
                    const diff = currentVal - previousVal;
                    // Only include constructors present in current or previous, and where delta is non-zero
                    if (diff !== 0 || currentVal > 0) { 
                        delta[category][key] = diff;
                    }
                }
            }
            return delta;
        }

        // Take Initial Snapshot & Analysis
        console.log('\n--- Initial Snapshot ---');
        const initialSnapshotData = await takeSnapshot(cdpSession); // Pass the obtained cdpSession
        let initialAnalysisResult = analyzeSnapshot(initialSnapshotData);
        // For the first report, delta is the counts themselves
        const initialReportData = {
            nodeCounts: initialAnalysisResult.nodeCounts,
            constructorCounts: initialAnalysisResult.constructorCounts,
            constructorCountsDelta: calculateConstructorDelta(initialAnalysisResult.constructorCounts, null) // Delta is initial count
        };
        await reportManager.saveReport(initialReportData, config.maxReports);
        let previousAnalysisResult = initialAnalysisResult;
        console.log('--- Initial Snapshot End ---');

        // State for leak detection heuristic
        let geometryIncreaseStreak = 0;
        let materialIncreaseStreak = 0;
        let textureIncreaseStreak = 0;
        let renderTargetIncreaseStreak = 0;
        let meshIncreaseStreak = 0;
        let groupIncreaseStreak = 0;

        // Step 5: Implement Snapshot Interval
        console.log(`\nSetting snapshot interval to ${config.interval}ms`);
        intervalId = setInterval(async () => {
            console.log('\n--- Interval Start ---');
            let snapshotDataString = null;
            try {
                snapshotDataString = await takeSnapshot(cdpSession); // Pass the obtained cdpSession
            } catch (snapshotError) {
                console.error(`Error taking snapshot: ${snapshotError.message}`);
                console.log('--- Interval End (skipped analysis due to snapshot error) ---');
                return;
            }

            let currentAnalysisResult = null;
            let reportData = null;

            if (snapshotDataString) {
                console.log(`Received snapshot data: ${Math.round(snapshotDataString.length / 1024)} KB`);
                currentAnalysisResult = analyzeSnapshot(snapshotDataString);

                const delta = calculateConstructorDelta(
                    currentAnalysisResult.constructorCounts,
                    previousAnalysisResult?.constructorCounts
                );

                reportData = {
                    nodeCounts: currentAnalysisResult.nodeCounts,
                    constructorCounts: currentAnalysisResult.constructorCounts,
                    constructorCountsDelta: delta
                };

                await reportManager.saveReport(reportData, config.maxReports);
            }

            // Step 8 & 9: Comparison Logic & Leak Detection Heuristic
            if (previousAnalysisResult?.nodeCounts && currentAnalysisResult?.nodeCounts) {
                const prevCounts = previousAnalysisResult.nodeCounts;
                const newCounts = currentAnalysisResult.nodeCounts; // Use nodeCounts property

                // Step 10: Log current counts
                console.log(`[${new Date().toLocaleTimeString()}] Counts - Geo: ${newCounts.geometryCount}, Mat: ${newCounts.materialCount}, Tex: ${newCounts.textureCount}, RT: ${newCounts.renderTargetCount}, Mesh: ${newCounts.meshCount}, Grp: ${newCounts.groupCount}`);

                // Compare Geometry
                if (newCounts.geometryCount > prevCounts.geometryCount) {
                    geometryIncreaseStreak++;
                    console.log(`Geometry count increased (${prevCounts.geometryCount} -> ${newCounts.geometryCount}). Streak: ${geometryIncreaseStreak}`);
                } else {
                    if (geometryIncreaseStreak > 0) {
                        console.log('Geometry count did not increase, resetting streak.');
                    }
                    geometryIncreaseStreak = 0;
                }

                // Compare Materials
                if (newCounts.materialCount > prevCounts.materialCount) {
                    materialIncreaseStreak++;
                    console.log(`Material count increased (${prevCounts.materialCount} -> ${newCounts.materialCount}). Streak: ${materialIncreaseStreak}`);
                } else {
                    if (materialIncreaseStreak > 0) {
                         console.log('Material count did not increase, resetting streak.');
                    }
                    materialIncreaseStreak = 0;
                }

                // Compare Textures
                if (newCounts.textureCount > prevCounts.textureCount) {
                    textureIncreaseStreak++;
                    console.log(`Texture count increased (${prevCounts.textureCount} -> ${newCounts.textureCount}). Streak: ${textureIncreaseStreak}`);
                } else {
                     if (textureIncreaseStreak > 0) {
                         console.log('Texture count did not increase, resetting streak.');
                    }
                    textureIncreaseStreak = 0;
                }

                // Compare Render Targets
                if (newCounts.renderTargetCount > prevCounts.renderTargetCount) {
                    renderTargetIncreaseStreak++;
                    console.log(`RenderTarget count increased (${prevCounts.renderTargetCount} -> ${newCounts.renderTargetCount}). Streak: ${renderTargetIncreaseStreak}`);
                } else {
                    if (renderTargetIncreaseStreak > 0) {
                        console.log('RenderTarget count did not increase, resetting streak.');
                    }
                    renderTargetIncreaseStreak = 0;
                }

                // Compare Meshes
                if (newCounts.meshCount > prevCounts.meshCount) {
                    meshIncreaseStreak++;
                    console.log(`Mesh count increased (${prevCounts.meshCount} -> ${newCounts.meshCount}). Streak: ${meshIncreaseStreak}`);
                } else {
                     if (meshIncreaseStreak > 0) {
                        console.log('Mesh count did not increase, resetting streak.');
                     }
                    meshIncreaseStreak = 0;
                }

                // Compare Groups
                if (newCounts.groupCount > prevCounts.groupCount) {
                    groupIncreaseStreak++;
                    console.log(`Group count increased (${prevCounts.groupCount} -> ${newCounts.groupCount}). Streak: ${groupIncreaseStreak}`);
                } else {
                     if (groupIncreaseStreak > 0) {
                         console.log('Group count did not increase, resetting streak.');
                     }
                    groupIncreaseStreak = 0;
                }

                // Step 10: Alerting
                if (geometryIncreaseStreak >= config.threshold) { // Use config value
                    console.warn(`*** Potential Geometry Leak Detected! Count increased for ${geometryIncreaseStreak} consecutive snapshots. ***`);
                    // Optional: Reset streak after warning? Or let it keep warning?
                    // geometryIncreaseStreak = 0; // Uncomment to warn only once per threshold breach
                }
                if (materialIncreaseStreak >= config.threshold) { // Use config value
                    console.warn(`*** Potential Material Leak Detected! Count increased for ${materialIncreaseStreak} consecutive snapshots. ***`);
                    // materialIncreaseStreak = 0;
                }
                if (textureIncreaseStreak >= config.threshold) { // Use config value
                    console.warn(`*** Potential Texture Leak Detected! Count increased for ${textureIncreaseStreak} consecutive snapshots. ***`);
                    // textureIncreaseStreak = 0;
                }
                // Added Alerts
                if (renderTargetIncreaseStreak >= config.threshold) { // Use config value
                    console.warn(`*** Potential RenderTarget Leak Detected! Count increased for ${renderTargetIncreaseStreak} consecutive snapshots. ***`);
                    // renderTargetIncreaseStreak = 0;
                }
                if (meshIncreaseStreak >= config.threshold) { // Use config value
                    console.warn(`*** Potential Mesh Leak Detected! Count increased for ${meshIncreaseStreak} consecutive snapshots. ***`);
                    // meshIncreaseStreak = 0;
                }
                if (groupIncreaseStreak >= config.threshold) { // Use config value
                    console.warn(`*** Potential Group Leak Detected! Count increased for ${groupIncreaseStreak} consecutive snapshots. ***`);
                    // groupIncreaseStreak = 0;
                }

            } else if (!currentAnalysisResult) {
                console.warn('Skipping comparison due to missing new snapshot data.');
            } else { // Only previousAnalysisResult exists (first interval after successful initial snapshot)
                const prevCounts = previousAnalysisResult.nodeCounts; // Use nodeCounts
                console.log(`[${new Date().toLocaleTimeString()}] Initial Counts - Geo: ${prevCounts.geometryCount}, Mat: ${prevCounts.materialCount}, Tex: ${prevCounts.textureCount}, RT: ${prevCounts.renderTargetCount}, Mesh: ${prevCounts.meshCount}, Grp: ${prevCounts.groupCount}`); // Added new types
            }
            // Update previousAnalysisResult for the next interval
            previousAnalysisResult = currentAnalysisResult || previousAnalysisResult; 
            console.log('--- Interval End ---');
        }, config.interval);

    } catch (error) {
        // Error handler already catches errors from initializeBrowser
        console.error('Watchdog failed to start or encountered a fatal error:', error.message); 
        // Cleanup interval if it was set
        if (intervalId) clearInterval(intervalId);
        // Cleanup server if it was started
        if (server) {
            await serverManager.stopServer(server).catch(err => console.error('Error stopping server during error cleanup:', err)); 
        }
        // Browser cleanup is handled within initializeBrowser on init failure,
        // or here if the error happened after successful browser init.
        if (browser) { // Check if browser was successfully initialized before the error
             await browserManager.closeBrowser(browser); 
        } 
        process.exit(1);
    }
}

runWatchdog();

// Basic cleanup on exit
process.on('SIGINT', async () => {
    console.log('Received SIGINT. Preparing to shutdown...');
    // Proper cleanup requires access to server, browser, intervalId.
    // This will be handled cleanly by the Watchdog class in later steps.
    console.warn("Cleanup on SIGINT is currently limited. Use Watchdog class for full resource management.");
    
    // Attempt basic exit for now
    // We can't reliably access `browser` or `server` or `intervalId` here yet.
    // await browserManager.closeBrowser(browser); // Needs access to `browser`
    // await serverManager.stopServer(server); // Needs access to `server`
    // clearInterval(intervalId); // Needs access to `intervalId`

    process.exit(0);
});

