// const puppeteer = require('puppeteer'); // Moved to browser-manager
const getConfig = require('./src/config.js');
const ReportManager = require('./src/report-manager.js');
const serverManager = require('./src/server.js');
const { analyzeSnapshot, calculateConstructorDelta } = require('./src/analyzer.js');
const { takeSnapshot } = require('./src/snapshotter.js');
const browserManager = require('./src/browser-manager.js'); // Require browser manager
const path = require('path');

// Placeholder requires for agent mode modules (DEPRECATED)
// const AgentConnection = require('./src/agent-connection.js');
// const InspectorClient = require('./src/inspector-client.js');

// --- Watchdog Class Definition ---
class Watchdog {
    constructor() {
        console.log("Initializing Watchdog...");
        this.config = getConfig();
        // Conditionally set the reports subdirectory
        const reportSubDir = this.config.isListenMode ? 'reports-client' : 'reports';
        this.reportManager = new ReportManager(__dirname, reportSubDir);
        
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
        
        console.log(`Watchdog Initialized. Running in ${this.config.isListenMode ? 'Listen' : 'Legacy'} mode.`);
        console.log("Config:", this.config);
    }

    // --- Main startup logic ---
    async start() {
        console.log('Starting Watchdog...');
        await this.reportManager.initializeDirectory();

        if (this.config.clearReports) {
            console.log('--clear-reports flag detected.');
            await this.reportManager.clearReports();
        }

        // Start the HTTP server and potentially the WebSocket server
        // The serverManager will internally check the mode from config
        try {
            this.server = await serverManager.startServer(this.config, this.reportManager, __dirname);
            // Note: startServer now needs to be async if WebSocket server setup inside is async
            console.log(`HTTP Report Server running on port ${this.config.serverPort}`);
            if (this.config.isListenMode) {
                 console.log(`WebSocket Server listening on port ${this.config.listenWssPort}`);
            }
        } catch (serverError) {
             console.error('Failed to start server(s):', serverError);
             await this.stop(); // Attempt cleanup
             process.exit(1);
        }

        if (!this.config.isListenMode) {
            // --- Legacy Mode Specific Startup ---
            console.log(`Legacy Mode: Monitoring URL: ${this.config.targetUrl}`);
            console.log(`Headless mode: ${this.config.isHeadless}`);
            console.log(`Snapshot interval: ${this.config.interval}ms`);
            console.log(`Leak threshold: ${this.config.threshold} increases`);

            try {
                // Puppeteer setup
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

                console.log(`\nSetting legacy snapshot interval to ${this.config.interval}ms`);
                // Start the interval timer only in Legacy mode
                this.intervalId = setInterval(this.runLegacyInterval.bind(this), this.config.interval);

            } catch (error) {
                console.error('Legacy Watchdog startup failed (after server start):', error.message);
                await this.stop(); // Attempt graceful shutdown
                process.exit(1);
            }

        } else {
            // --- Listen Mode Specific Startup ---
            console.log(`Listen Mode: Waiting for client connections on ws://localhost:${this.config.listenWssPort}`);
            // No interval timer needed here; actions are triggered by client messages
        }

        console.log("Watchdog running. Press Ctrl+C to stop.");
    }

    // --- Interval callback logic (LEGACY MODE ONLY) ---
    async runLegacyInterval() {
        // Renamed from runInterval to be specific
        if (this.config.isListenMode) return; // Should not be called in listen mode

        console.log('\n--- Legacy Interval Start ---');
        let snapshotDataString = null;
        try {
            snapshotDataString = await takeSnapshot(this.cdpSession);
        } catch (snapshotError) {
            console.error(`Error taking snapshot: ${snapshotError.message}`);
            console.log('--- Legacy Interval End (skipped analysis due to snapshot error) ---');
            return; // Skip rest of interval
        }

        let currentAnalysisResult = null;
        let reportData = null;

        if (snapshotDataString) {
            // console.log(`Received snapshot data: ${Math.round(snapshotDataString.length / 1024)} KB`);
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
        console.log('--- Legacy Interval End ---');
    }

    // --- Implement Stop method --- 
    async stop() {
        console.log('Watchdog stopping gracefully...');
        
        // 1. Clear Legacy Interval (Common for legacy mode)
        if (this.intervalId) {
            console.log('- Clearing legacy interval...');
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        // 2. Stop Server (HTTP + potentially WebSocket)
        // serverManager.stopServer should handle closing both if needed
        if (this.server) {
            console.log('- Stopping server(s)...');
            try {
                await serverManager.stopServer(this.server);
                this.server = null;
            } catch (err) {
                console.error('  Error stopping server(s):', err.message);
            }
        }

        // 3. Close Browser (Legacy Mode Only)
        if (!this.config.isListenMode && this.browser) {
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

// --- Main Execution Logic ---
let watchdogInstance = null;

async function run() {
    try {
        watchdogInstance = new Watchdog(); // Assign instance
        await watchdogInstance.start();
    } catch (error) {
        console.error("Critical error during watchdog startup:", error);
        if (watchdogInstance) {
            await watchdogInstance.stop();
        }
        process.exit(1);
    }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
    console.log('\nSIGINT received. Stopping Watchdog...');
    if (watchdogInstance) {
        await watchdogInstance.stop();
    }
    process.exit(0);
});

run(); // Start the watchdog

