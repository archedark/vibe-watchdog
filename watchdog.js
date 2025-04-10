// const puppeteer = require('puppeteer'); // Moved to browser-manager
const getConfig = require('./src/config.js');
const ReportManager = require('./src/report-manager.js');
const serverManager = require('./src/server.js');
const { analyzeSnapshot, calculateConstructorDelta } = require('./src/analyzer.js');
const { takeSnapshot } = require('./src/snapshotter.js');
const browserManager = require('./src/browser-manager.js'); // Require browser manager
const path = require('path');

// --- Watchdog Class Definition ---
class Watchdog {
    constructor() {
        console.log("Initializing Watchdog...");
        this.config = getConfig();
        this.reportManager = new ReportManager(__dirname);
        
        // State variables initialized to null/defaults
        this.server = null;
        this.browser = null;
        this.cdpSession = null;
        this.gamePage = null; // Keep track of gamePage if needed later
        this.intervalId = null;
        this.previousAnalysisResult = null;

        // Leak detection state
        this.geometryIncreaseStreak = 0;
        this.materialIncreaseStreak = 0;
        this.textureIncreaseStreak = 0;
        this.renderTargetIncreaseStreak = 0;
        this.meshIncreaseStreak = 0;
        this.groupIncreaseStreak = 0;
        
        console.log("Watchdog Initialized with config:", this.config);
    }

    // --- Main startup logic ---
    async start() {
        console.log(`Starting Watchdog for URL: ${this.config.targetUrl}`);
        console.log(`Headless mode: ${this.config.isHeadless}`);
        console.log(`Snapshot interval: ${this.config.interval}ms`);
        console.log(`Leak threshold: ${this.config.threshold} increases`);
        console.log(`Maximum reports to keep: ${this.config.maxReports}`);
        console.log(`Report viewer server starting on port: ${this.config.serverPort}`);
        console.warn('Watchdog started. Using simplified analysis for MVP - results may be inaccurate.');

        try {
            await this.reportManager.initializeDirectory();

            if (this.config.clearReports) {
                console.log('--clear-reports flag detected.');
                await this.reportManager.clearReports();
            }

            this.server = serverManager.startServer(this.config, this.reportManager, __dirname);

            const { browser, gamePage, cdpSession } = await browserManager.initializeBrowser(this.config);
            this.browser = browser;
            this.gamePage = gamePage;
            this.cdpSession = cdpSession;
            
            console.log('\n--- Initial Snapshot ---');
            const initialSnapshotData = await takeSnapshot(this.cdpSession);
            this.previousAnalysisResult = analyzeSnapshot(initialSnapshotData);
            
            const initialReportData = {
                nodeCounts: this.previousAnalysisResult.nodeCounts,
                constructorCounts: this.previousAnalysisResult.constructorCounts,
                constructorCountsDelta: calculateConstructorDelta(this.previousAnalysisResult.constructorCounts, null)
            };
            await this.reportManager.saveReport(initialReportData, this.config.maxReports);
            console.log('--- Initial Snapshot End ---');

            console.log(`\nSetting snapshot interval to ${this.config.interval}ms`);
            this.intervalId = setInterval(this.runInterval.bind(this), this.config.interval);

            console.log("Watchdog running. Press Ctrl+C to stop.");

        } catch (error) {
            console.error('Watchdog failed to start:', error.message);
            await this.stop(); // Attempt graceful shutdown on startup error
            process.exit(1);
        }
    }

    // --- Interval callback logic ---
    async runInterval() {
        console.log('\n--- Interval Start ---');
        let snapshotDataString = null;
        try {
            snapshotDataString = await takeSnapshot(this.cdpSession);
        } catch (snapshotError) {
            console.error(`Error taking snapshot: ${snapshotError.message}`);
            console.log('--- Interval End (skipped analysis due to snapshot error) ---');
            return; // Skip rest of interval
        }

        let currentAnalysisResult = null;
        let reportData = null;

        if (snapshotDataString) {
            console.log(`Received snapshot data: ${Math.round(snapshotDataString.length / 1024)} KB`);
            currentAnalysisResult = analyzeSnapshot(snapshotDataString);

            const delta = calculateConstructorDelta(
                currentAnalysisResult.constructorCounts,
                this.previousAnalysisResult?.constructorCounts
            );

            reportData = {
                nodeCounts: currentAnalysisResult.nodeCounts,
                constructorCounts: currentAnalysisResult.constructorCounts,
                constructorCountsDelta: delta
            };

            await this.reportManager.saveReport(reportData, this.config.maxReports);
        }

        // Comparison Logic & Leak Detection
        if (this.previousAnalysisResult?.nodeCounts && currentAnalysisResult?.nodeCounts) {
            const prevCounts = this.previousAnalysisResult.nodeCounts;
            const newCounts = currentAnalysisResult.nodeCounts;

            console.log(`[${new Date().toLocaleTimeString()}] Counts - Geo: ${newCounts.geometryCount}, Mat: ${newCounts.materialCount}, Tex: ${newCounts.textureCount}, RT: ${newCounts.renderTargetCount}, Mesh: ${newCounts.meshCount}, Grp: ${newCounts.groupCount}`);

            // Compare Geometry
            if (newCounts.geometryCount > prevCounts.geometryCount) {
                this.geometryIncreaseStreak++;
                console.log(`Geometry count increased (${prevCounts.geometryCount} -> ${newCounts.geometryCount}). Streak: ${this.geometryIncreaseStreak}`);
            } else {
                if (this.geometryIncreaseStreak > 0) console.log('Geometry count did not increase, resetting streak.');
                this.geometryIncreaseStreak = 0;
            }
            // Compare Materials
            if (newCounts.materialCount > prevCounts.materialCount) {
                this.materialIncreaseStreak++;
                console.log(`Material count increased (${prevCounts.materialCount} -> ${newCounts.materialCount}). Streak: ${this.materialIncreaseStreak}`);
            } else {
                if (this.materialIncreaseStreak > 0) console.log('Material count did not increase, resetting streak.');
                this.materialIncreaseStreak = 0;
            }
            // Compare Textures
            if (newCounts.textureCount > prevCounts.textureCount) {
                this.textureIncreaseStreak++;
                console.log(`Texture count increased (${prevCounts.textureCount} -> ${newCounts.textureCount}). Streak: ${this.textureIncreaseStreak}`);
            } else {
                if (this.textureIncreaseStreak > 0) console.log('Texture count did not increase, resetting streak.');
                this.textureIncreaseStreak = 0;
            }
            // Compare Render Targets
            if (newCounts.renderTargetCount > prevCounts.renderTargetCount) {
                this.renderTargetIncreaseStreak++;
                console.log(`RenderTarget count increased (${prevCounts.renderTargetCount} -> ${newCounts.renderTargetCount}). Streak: ${this.renderTargetIncreaseStreak}`);
            } else {
                if (this.renderTargetIncreaseStreak > 0) console.log('RenderTarget count did not increase, resetting streak.');
                this.renderTargetIncreaseStreak = 0;
            }
            // Compare Meshes
            if (newCounts.meshCount > prevCounts.meshCount) {
                this.meshIncreaseStreak++;
                console.log(`Mesh count increased (${prevCounts.meshCount} -> ${newCounts.meshCount}). Streak: ${this.meshIncreaseStreak}`);
            } else {
                if (this.meshIncreaseStreak > 0) console.log('Mesh count did not increase, resetting streak.');
                this.meshIncreaseStreak = 0;
            }
            // Compare Groups
            if (newCounts.groupCount > prevCounts.groupCount) {
                this.groupIncreaseStreak++;
                console.log(`Group count increased (${prevCounts.groupCount} -> ${newCounts.groupCount}). Streak: ${this.groupIncreaseStreak}`);
            } else {
                if (this.groupIncreaseStreak > 0) console.log('Group count did not increase, resetting streak.');
                this.groupIncreaseStreak = 0;
            }

            // Alerting
            if (this.geometryIncreaseStreak >= this.config.threshold) {
                console.warn(`*** Potential Geometry Leak Detected! Count increased for ${this.geometryIncreaseStreak} consecutive snapshots. ***`);
            }
            if (this.materialIncreaseStreak >= this.config.threshold) {
                console.warn(`*** Potential Material Leak Detected! Count increased for ${this.materialIncreaseStreak} consecutive snapshots. ***`);
            }
            if (this.textureIncreaseStreak >= this.config.threshold) {
                console.warn(`*** Potential Texture Leak Detected! Count increased for ${this.textureIncreaseStreak} consecutive snapshots. ***`);
            }
            if (this.renderTargetIncreaseStreak >= this.config.threshold) {
                console.warn(`*** Potential RenderTarget Leak Detected! Count increased for ${this.renderTargetIncreaseStreak} consecutive snapshots. ***`);
            }
            if (this.meshIncreaseStreak >= this.config.threshold) {
                console.warn(`*** Potential Mesh Leak Detected! Count increased for ${this.meshIncreaseStreak} consecutive snapshots. ***`);
            }
            if (this.groupIncreaseStreak >= this.config.threshold) {
                console.warn(`*** Potential Group Leak Detected! Count increased for ${this.groupIncreaseStreak} consecutive snapshots. ***`);
            }

        } else if (!currentAnalysisResult) {
            console.warn('Skipping comparison due to missing new snapshot data.');
        }
        // Update previousAnalysisResult for the next interval
        this.previousAnalysisResult = currentAnalysisResult || this.previousAnalysisResult;
        console.log('--- Interval End ---');
    }

    // --- Implement Stop method --- 
    async stop() {
        console.log('Watchdog stopping gracefully...');
        
        // 1. Clear Interval
        if (this.intervalId) {
            console.log('- Clearing snapshot interval...');
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        // 2. Stop Server (wait for it to close)
        if (this.server) {
            console.log('- Stopping report server...');
            try {
                await serverManager.stopServer(this.server);
                this.server = null;
            } catch (err) {
                console.error('  Error stopping server:', err.message);
            }
        }

        // 3. Close Browser (wait for it to close)
        if (this.browser) {
            console.log('- Closing browser...');
            try {
                await browserManager.closeBrowser(this.browser);
                this.browser = null;
            } catch (err) {
                console.error('  Error closing browser:', err.message);
            }
        }

        console.log('Watchdog stopped.');
    }
}

// --- Main Execution Logic (Adjusted for SIGINT access) ---
let watchdogInstance = null; // Declare outside

async function run() {
    watchdogInstance = new Watchdog(); // Assign instance
    try {
        await watchdogInstance.start();
    } catch (error) {
        // Errors during start should be handled within start() or caught here
        console.error("Critical error during watchdog startup:", error);
        // Ensure stop is called even if start partially fails and throws
        if (watchdogInstance) {
            await watchdogInstance.stop(); 
        }        
        process.exit(1);
    }
}

run(); // Start the application

// --- Updated SIGINT Handler ---
process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT. Shutting down watchdog...');
    if (watchdogInstance) {
        await watchdogInstance.stop();
    } else {
        console.warn('Watchdog instance not available for cleanup.');
    }
    process.exit(0);
});

