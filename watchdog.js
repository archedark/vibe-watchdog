const puppeteer = require('puppeteer');
const getConfig = require('./src/config.js'); // Import the config module
const ReportManager = require('./src/report-manager.js'); // Require ReportManager
const serverManager = require('./src/server.js'); // Require the server module
const fs = require('fs').promises; // Added for file system operations
const path = require('path'); // Added for path manipulation
const { analyzeSnapshot } = require('./src/analyzer.js'); // Require the analyzer function
const { takeSnapshot } = require('./src/snapshotter.js'); // Require the snapshotter function

// --- Config is now handled in config.js ---

// --- Run the watchdog ---
async function runWatchdog() {
    const config = getConfig(); // Get configuration object
    const reportManager = new ReportManager(__dirname); // Instantiate ReportManager

    console.log(`Starting Watchdog for URL: ${config.targetUrl}`);
    console.log(`Headless mode: ${config.isHeadless}`);
    console.log(`Snapshot interval: ${config.interval}ms`);
    console.log(`Leak threshold: ${config.threshold} increases`);
    console.log(`Maximum reports to keep: ${config.maxReports}`); // Log the max reports value
    console.log(`Report viewer server starting on port: ${config.serverPort}`); // Log server port
    console.warn('Watchdog started. Using simplified analysis for MVP - results may be inaccurate.');

    // Reports directory is now managed by ReportManager
    let server; // Keep server variable to hold the instance
    let browser;
    let intervalId; // Declare intervalId for cleanup

    try {
        // --- Initialize Report Directory ---
        await reportManager.initializeDirectory();

        // --- Clear Reports Logic (using ReportManager) ---
        if (config.clearReports) {
            console.log('--clear-reports flag detected.'); // Log simplified message
            await reportManager.clearReports();
        }
        // --- End Clear Reports Logic ---

        // --- Start the Server (using server.js) ---
        server = serverManager.startServer(config, reportManager, __dirname); // Start server and store instance

        // Start the server *before* launching Puppeteer
        browser = await puppeteer.launch({ 
            headless: config.isHeadless, // Use config value
            defaultViewport: null,
        });
        // Get initial page (often about:blank) and navigate it to the report viewer
        const initialPages = await browser.pages();
        const reportViewerPage = initialPages.length > 0 ? initialPages[0] : await browser.newPage(); // Reuse or create
        try {
            console.log(`Navigating initial tab to report viewer: http://localhost:${config.serverPort}`); // Use config value
            await reportViewerPage.goto(`http://localhost:${config.serverPort}`, { waitUntil: 'networkidle0' }); // Use config value
        } catch (viewerNavError) {
             console.warn(`Warning: Failed to navigate initial tab to report viewer: ${viewerNavError.message}`);
             // Continue execution even if the viewer fails to load
        }

        // Now create a new page for the target game/app
        const gamePage = await browser.newPage();

        console.log(`Navigating new tab to ${config.targetUrl}...`); // Use config value
        await gamePage.goto(config.targetUrl, { waitUntil: 'networkidle0' }); // Use config value
        console.log('Game page loaded successfully.');

        // Steps 3-10 will go here...
        console.log('Connecting to DevTools Protocol on game page...');
        // Ensure CDP session is attached to the GAME PAGE
        const cdpSession = await gamePage.target().createCDPSession();

        await cdpSession.send('HeapProfiler.enable');
        console.log('HeapProfiler enabled.');

        // Step 7: Robust Snapshot Parsing (Graph Traversal + Constructor Finding)
        // --- The analyzeSnapshot function and its associated constants
        //     (typeToCountKey, knownThreejsTypes, jsBuiltIns, webglInternalsExclude, 
        //      browserApiExcludes, domExcludes, threeHelpersExclude, threeLoadersExclude,
        //      threeMathExclude, threeCurvesExclude, typedArrayAndAttributesExclude,
        //      otherLibsExclude, manualMiscExcludes, etc.)
        //     have been moved to src/analyzer.js ---

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
        const initialSnapshotData = await takeSnapshot(cdpSession); // Call imported function
        let initialAnalysisResult = analyzeSnapshot(initialSnapshotData); // Call imported function
        // For the first report, delta is the counts themselves
        const initialReportData = {
            nodeCounts: initialAnalysisResult.nodeCounts,
            constructorCounts: initialAnalysisResult.constructorCounts,
            constructorCountsDelta: calculateConstructorDelta(initialAnalysisResult.constructorCounts, null) // Delta is initial count
        };
        await reportManager.saveReport(initialReportData, config.maxReports); // Use ReportManager method
        let previousAnalysisResult = initialAnalysisResult; // Use the full result object from analyzeSnapshot
        console.log('--- Initial Snapshot End ---');

        // State for leak detection heuristic
        let geometryIncreaseStreak = 0;
        let materialIncreaseStreak = 0;
        let textureIncreaseStreak = 0;
        let renderTargetIncreaseStreak = 0;
        let meshIncreaseStreak = 0;
        let groupIncreaseStreak = 0;

        // Step 5: Implement Snapshot Interval
        console.log(`\nSetting snapshot interval to ${config.interval}ms`); // Use config value
        // Assign interval to the previously declared variable
        intervalId = setInterval(async () => {
            console.log('\n--- Interval Start ---');
            let snapshotDataString = null; // Initialize to null
            try { // Add try/catch around snapshot taking
                // Step 6: Retrieve snapshot data
                snapshotDataString = await takeSnapshot(cdpSession); // Call imported function
            } catch (snapshotError) {
                console.error(`Error taking snapshot: ${snapshotError.message}`);
                // Decide if we should stop the interval or just skip this iteration
                // For now, just log and continue the interval
                console.log('--- Interval End (skipped analysis due to snapshot error) ---');
                return; // Skip the rest of the interval function
            }

            let currentAnalysisResult = null;
            let reportData = null; // Initialize reportData

            if (snapshotDataString) {
                console.log(`Received snapshot data: ${Math.round(snapshotDataString.length / 1024)} KB`);
                // Step 7: Analyze snapshot
                currentAnalysisResult = analyzeSnapshot(snapshotDataString); // Call imported function

                // Calculate Delta
                const delta = calculateConstructorDelta(
                    currentAnalysisResult.constructorCounts,
                    previousAnalysisResult?.constructorCounts // Pass previous counts safely
                );

                // Prepare data for the report
                reportData = {
                    nodeCounts: currentAnalysisResult.nodeCounts,
                    constructorCounts: currentAnalysisResult.constructorCounts,
                    constructorCountsDelta: delta
                };

                await reportManager.saveReport(reportData, config.maxReports); // Use ReportManager method
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
        }, config.interval); // Use config value

        // Keep the browser open while the interval is running
        // Cleanup logic needs to handle stopping the interval and closing the browser

        // The process will now stay alive due to the interval AND the server
        // await browser.close(); // Will be moved to cleanup logic

    } catch (error) {
        console.error('Error during browser operation or server startup:', error.message);
        if (intervalId) clearInterval(intervalId); // Clear interval on error
        // --- Stop server on error (using server.js) ---
        if (server) {
            await serverManager.stopServer(server).catch(err => console.error('Error stopping server during cleanup:', err)); // Add error handling for stop
        }
        if (browser) {
            await browser.close();
        }
        process.exit(1); // Exit if browser setup or navigation fails
    }
}

runWatchdog();
// Basic cleanup on exit
process.on('SIGINT', async () => {
    console.log('Received SIGINT. Closing browser, stopping interval and server...');
    // Add cleanup logic here if browser is accessible globally or passed around
    // Need to clear the interval and close the browser properly
    // For now, we rely on the main function's try/catch, but proper cleanup needed later

    // Proper Cleanup Attempt: (Needs access to intervalId, browser, server)
    // Need to make intervalId, browser, and server accessible here.
    // A simple way is to declare them outside runWatchdog, but this pollutes global scope.
    // A better way involves structuring the app differently, maybe using classes or modules.
    // For now, we'll rely on the OS cleaning up, but this is not ideal.

    // --- Add Server Shutdown to SIGINT --- 
    // This part needs access to the `server` variable. We will address this properly
    // when introducing the Watchdog class. For now, it won't automatically close on SIGINT.
    // if (server) await serverManager.stopServer(server); 

    // if (intervalId) clearInterval(intervalId); // Needs interval
    // if (browser) await browser.close(); // Needs browser
    console.warn("Cleanup on SIGINT is basic. Ensure resources are closed if errors occur before full setup. Server might not close automatically on Ctrl+C yet.");
    process.exit(0);
});

