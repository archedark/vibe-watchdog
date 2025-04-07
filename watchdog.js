const puppeteer = require('puppeteer');
const minimist = require('minimist');

const args = minimist(process.argv.slice(2));

const targetUrl = args.url;
const isHeadless = args.headless || false; // Default to false (visible browser)
const interval = args.interval || 30000; // Default to 30 seconds
const threshold = args.threshold || 3; // Default to 3 consecutive increases

if (!targetUrl) {
    console.error('Error: --url parameter is required.');
    console.log('Usage: node watchdog.js --url <your-game-url> [--headless] [--interval <ms>] [--threshold <count>]');
    process.exit(1);
}

async function runWatchdog() {
    console.log(`Starting Watchdog for URL: ${targetUrl}`);
    console.log(`Headless mode: ${isHeadless}`);
    console.log(`Snapshot interval: ${interval}ms`);
    console.log(`Leak threshold: ${threshold} increases`);
    console.warn('Watchdog started. Using simplified analysis for MVP - results may be inaccurate.');

    let browser;
    try {
        browser = await puppeteer.launch({ headless: isHeadless });
        const page = await browser.newPage();

        console.log(`Navigating to ${targetUrl}...`);
        await page.goto(targetUrl, { waitUntil: 'networkidle0' }); // Wait until network is idle
        console.log('Page loaded successfully.');

        // Steps 3-10 will go here...
        console.log('Connecting to DevTools Protocol...');
        const cdpSession = await page.target().createCDPSession();

        // --- BEGIN ADDED DEBUG ---
        // console.log('Attaching listener for ALL CDP session events...');
        // cdpSession.on('*', (eventName, eventData) => {
        //     // Avoid logging excessively large data chunks if they *do* eventually appear
        //     if (eventName === 'HeapProfiler.addHeapSnapshotChunk') {
        //         console.log(`DEBUG (Generic Listener): Received event: ${eventName} (Chunk length: ${eventData.chunk.length})`);
        //     } else if (eventName === 'HeapProfiler.reportHeapSnapshotProgress') {
        //          console.log(`DEBUG (Generic Listener): Received event: ${eventName} (Done: ${eventData.done}/${eventData.total})`);
        //     } else {
        //         // Log other events concisely
        //         console.log(`DEBUG (Generic Listener): Received event: ${eventName}`);
        //         // Optionally log small event data:
        //         // try {
        //         //     const dataStr = JSON.stringify(eventData);
        //         //     if (dataStr.length < 200) { // Log only small data payloads
        //         //         console.log(`  Data: ${dataStr}`);
        //         //     } else {
        //         //          console.log(`  Data: [Too large to log]`);
        //         //     }
        //         // } catch (e) {
        //         //      console.log(`  Data: [Cannot stringify]`);
        //         // }
        //     }
        // });
        // --- END ADDED DEBUG ---

        await cdpSession.send('HeapProfiler.enable');
        console.log('HeapProfiler enabled.');

        // Function to take a heap snapshot (more robust waiting)
        async function takeSnapshot(session) {
            console.log('Taking heap snapshot...');
            const SNAPSHOT_TIMEOUT_MS = 60000; // 60 seconds overall timeout
            const CHUNK_QUIET_PERIOD_MS = 500; // Wait 500ms after last chunk/finished signal

            return new Promise(async (resolve, reject) => {
                let chunks = [];
                let finishedReported = false;
                let progressListener;
                let chunkListener;
                let overallTimeoutId;
                let quietPeriodTimeoutId = null; // Timeout for waiting after last chunk

                const cleanup = () => {
                    clearTimeout(overallTimeoutId);
                    clearTimeout(quietPeriodTimeoutId);
                    if (chunkListener) session.off('HeapProfiler.addHeapSnapshotChunk', chunkListener);
                    if (progressListener) session.off('HeapProfiler.reportHeapSnapshotProgress', progressListener);
                };

                const finalizeSnapshot = () => {
                    console.log(`Snapshot finalize triggered. Joining ${chunks.length} chunks.`);
                    cleanup();
                    resolve(chunks.join(''));
                };

                overallTimeoutId = setTimeout(() => {
                    cleanup();
                    console.error(`Snapshot timed out after ${SNAPSHOT_TIMEOUT_MS / 1000} seconds.`);
                    reject(new Error('Snapshot timeout'));
                }, SNAPSHOT_TIMEOUT_MS);

                chunkListener = (event) => {
                    // Clear any existing quiet period timeout, as we just got a chunk
                    clearTimeout(quietPeriodTimeoutId);

                    chunks.push(event.chunk);
                    // console.log(`DEBUG: Received chunk, length: ${event.chunk.length}, total chunks: ${chunks.length}`);

                    // If finished has been reported, set a new timeout to finalize
                    // If more chunks arrive, this timeout will be cleared and reset
                    if (finishedReported) {
                        quietPeriodTimeoutId = setTimeout(finalizeSnapshot, CHUNK_QUIET_PERIOD_MS);
                    }
                };

                progressListener = (event) => {
                    // console.log(`Snapshot progress: ${event.done}/${event.total}`);
                    if (event.finished) {
                        console.log(`Snapshot finished reporting (Size ${event.total} reported, may be inaccurate).`);
                        finishedReported = true;
                        session.off('HeapProfiler.reportHeapSnapshotProgress', progressListener);
                        progressListener = null;

                        // Start the quiet period timeout now in case no more chunks arrive *at all*
                        // or if they arrived before this 'finished' signal
                        clearTimeout(quietPeriodTimeoutId); // Clear any previous just in case
                        quietPeriodTimeoutId = setTimeout(finalizeSnapshot, CHUNK_QUIET_PERIOD_MS);
                    }
                };

                session.on('HeapProfiler.addHeapSnapshotChunk', chunkListener);
                session.on('HeapProfiler.reportHeapSnapshotProgress', progressListener);

                try {
                    console.log('Sending HeapProfiler.takeHeapSnapshot command...');
                    await session.send('HeapProfiler.takeHeapSnapshot', { reportProgress: true, treatGlobalObjectsAsRoots: true }); // Added treatGlobalObjectsAsRoots
                    // console.log('Snapshot command sent, waiting for progress and chunks...');
                } catch (err) {
                    console.error('Error sending takeHeapSnapshot command:', err.message);
                    cleanup();
                    reject(err);
                }
            });
        }

        // Step 7: Basic Snapshot Parsing (MVP Implementation - slightly improved)
        function analyzeSnapshot(snapshotJsonString) {
            console.log('Analyzing snapshot (MVP JSON string array search)...');
            if (!snapshotJsonString) {
                console.warn('Cannot analyze empty snapshot data.');
                // Return object with all expected keys
                return { geometryCount: 0, materialCount: 0, textureCount: 0, renderTargetCount: 0, meshCount: 0, groupCount: 0 };
            }

            let geometryCount = 0;
            let materialCount = 0;
            let textureCount = 0;
            let renderTargetCount = 0;
            let meshCount = 0;
            let groupCount = 0;
            // let object3DCount = 0; // Keep Object3D commented for now to avoid double counts

            try {
                const snapshot = JSON.parse(snapshotJsonString);
                if (snapshot && snapshot.strings && Array.isArray(snapshot.strings)) {
                    // console.log(`DEBUG: Searching within ${snapshot.strings.length} strings in the snapshot.`);

                    // More targeted, but still basic, search within the strings array
                    for (const str of snapshot.strings) {
                        // Use includes for simple substring matching
                        if (str.includes('BufferGeometry')) {
                            geometryCount++;
                        }
                        // Be careful with generic 'Material' - might match unrelated things
                        if (str.includes('Material') && !str.includes('MaterialDefinition') && !str.includes('MaterialLoader') && !str.includes('MaterialCreator')) {
                            materialCount++;
                        }
                        if (str.includes('Texture') && !str.includes('TextureEncoding') && !str.includes('TextureLoader')) {
                            textureCount++;
                        }
                        // Added types
                        if (str.includes('WebGLRenderTarget')) { // Catches WebGLCubeRenderTarget too
                            renderTargetCount++;
                        }
                        // Basic Mesh count - might need refinement later if Skinned/Instanced added
                        if (str === 'Mesh') { // Try exact match for Mesh first
                             meshCount++;
                        } else if (str.includes('Mesh') && !str.includes('SkinnedMesh') && !str.includes('InstancedMesh') && !str.includes('TextMesh')) { // Broader match with exclusions
                             // This might overcount if 'Mesh' appears in other contexts, but is a starting point
                             meshCount++;
                        }
                        if (str === 'Group') { // Exact match for Group
                             groupCount++;
                        }
                        // if (str === 'Object3D') { object3DCount++; } // Still skip base Object3D for MVP
                    }
                } else {
                    console.warn('Snapshot JSON parsed, but snapshot.strings array not found or not an array.');
                }
            } catch (e) {
                console.error('Error parsing snapshot JSON:', e.message);
                return { geometryCount: 0, materialCount: 0, textureCount: 0, renderTargetCount: 0, meshCount: 0, groupCount: 0 };
            }

            console.log(`Analysis - Geo: ${geometryCount}, Mat: ${materialCount}, Tex: ${textureCount}, RT: ${renderTargetCount}, Mesh: ${meshCount}, Grp: ${groupCount}`);
            return { geometryCount, materialCount, textureCount, renderTargetCount, meshCount, groupCount };
        }

        // Take Initial Snapshot & Analysis
        console.log('\n--- Initial Snapshot ---');
        const initialSnapshotData = await takeSnapshot(cdpSession);
        let previousCounts = analyzeSnapshot(initialSnapshotData);
        console.log('--- Initial Snapshot End ---');

        // State for leak detection heuristic
        let geometryIncreaseStreak = 0;
        let materialIncreaseStreak = 0;
        let textureIncreaseStreak = 0;
        let renderTargetIncreaseStreak = 0;
        let meshIncreaseStreak = 0;
        let groupIncreaseStreak = 0;

        // Step 5: Implement Snapshot Interval
        console.log(`\nSetting snapshot interval to ${interval}ms`);
        const intervalId = setInterval(async () => {
            console.log('\n--- Interval Start ---');
            // Step 6: Retrieve snapshot data
            const snapshotDataString = await takeSnapshot(cdpSession);

            let newCounts = null;
            if (snapshotDataString) {
                console.log(`Received snapshot data: ${Math.round(snapshotDataString.length / 1024)} KB`);
                // Step 7: Analyze snapshot
                newCounts = analyzeSnapshot(snapshotDataString);
            }

            // Step 8 & 9: Comparison Logic & Leak Detection Heuristic
            if (previousCounts && newCounts) {
                // Step 10: Log current counts
                console.log(`[${new Date().toLocaleTimeString()}] Counts - Geo: ${newCounts.geometryCount}, Mat: ${newCounts.materialCount}, Tex: ${newCounts.textureCount}, RT: ${newCounts.renderTargetCount}, Mesh: ${newCounts.meshCount}, Grp: ${newCounts.groupCount}`);

                // Compare Geometry
                if (newCounts.geometryCount > previousCounts.geometryCount) {
                    geometryIncreaseStreak++;
                    console.log(`Geometry count increased (${previousCounts.geometryCount} -> ${newCounts.geometryCount}). Streak: ${geometryIncreaseStreak}`);
                } else {
                    if (geometryIncreaseStreak > 0) {
                        console.log('Geometry count did not increase, resetting streak.');
                    }
                    geometryIncreaseStreak = 0;
                }

                // Compare Materials
                if (newCounts.materialCount > previousCounts.materialCount) {
                    materialIncreaseStreak++;
                    console.log(`Material count increased (${previousCounts.materialCount} -> ${newCounts.materialCount}). Streak: ${materialIncreaseStreak}`);
                } else {
                    if (materialIncreaseStreak > 0) {
                         console.log('Material count did not increase, resetting streak.');
                    }
                    materialIncreaseStreak = 0;
                }

                // Compare Textures
                if (newCounts.textureCount > previousCounts.textureCount) {
                    textureIncreaseStreak++;
                    console.log(`Texture count increased (${previousCounts.textureCount} -> ${newCounts.textureCount}). Streak: ${textureIncreaseStreak}`);
                } else {
                     if (textureIncreaseStreak > 0) {
                         console.log('Texture count did not increase, resetting streak.');
                    }
                    textureIncreaseStreak = 0;
                }

                // Compare Render Targets
                if (newCounts.renderTargetCount > previousCounts.renderTargetCount) {
                    renderTargetIncreaseStreak++;
                    console.log(`RenderTarget count increased (${previousCounts.renderTargetCount} -> ${newCounts.renderTargetCount}). Streak: ${renderTargetIncreaseStreak}`);
                } else {
                    if (renderTargetIncreaseStreak > 0) {
                        console.log('RenderTarget count did not increase, resetting streak.');
                    }
                    renderTargetIncreaseStreak = 0;
                }

                // Compare Meshes
                if (newCounts.meshCount > previousCounts.meshCount) {
                    meshIncreaseStreak++;
                    console.log(`Mesh count increased (${previousCounts.meshCount} -> ${newCounts.meshCount}). Streak: ${meshIncreaseStreak}`);
                } else {
                     if (meshIncreaseStreak > 0) {
                        console.log('Mesh count did not increase, resetting streak.');
                     }
                    meshIncreaseStreak = 0;
                }

                // Compare Groups
                if (newCounts.groupCount > previousCounts.groupCount) {
                    groupIncreaseStreak++;
                    console.log(`Group count increased (${previousCounts.groupCount} -> ${newCounts.groupCount}). Streak: ${groupIncreaseStreak}`);
                } else {
                     if (groupIncreaseStreak > 0) {
                         console.log('Group count did not increase, resetting streak.');
                     }
                    groupIncreaseStreak = 0;
                }

                // Step 10: Alerting
                if (geometryIncreaseStreak >= threshold) {
                    console.warn(`*** Potential Geometry Leak Detected! Count increased for ${geometryIncreaseStreak} consecutive snapshots. ***`);
                    // Optional: Reset streak after warning? Or let it keep warning?
                    // geometryIncreaseStreak = 0; // Uncomment to warn only once per threshold breach
                }
                if (materialIncreaseStreak >= threshold) {
                    console.warn(`*** Potential Material Leak Detected! Count increased for ${materialIncreaseStreak} consecutive snapshots. ***`);
                    // materialIncreaseStreak = 0;
                }
                if (textureIncreaseStreak >= threshold) {
                    console.warn(`*** Potential Texture Leak Detected! Count increased for ${textureIncreaseStreak} consecutive snapshots. ***`);
                    // textureIncreaseStreak = 0;
                }
                // Added Alerts
                if (renderTargetIncreaseStreak >= threshold) {
                    console.warn(`*** Potential RenderTarget Leak Detected! Count increased for ${renderTargetIncreaseStreak} consecutive snapshots. ***`);
                    // renderTargetIncreaseStreak = 0;
                }
                if (meshIncreaseStreak >= threshold) {
                    console.warn(`*** Potential Mesh Leak Detected! Count increased for ${meshIncreaseStreak} consecutive snapshots. ***`);
                    // meshIncreaseStreak = 0;
                }
                if (groupIncreaseStreak >= threshold) {
                    console.warn(`*** Potential Group Leak Detected! Count increased for ${groupIncreaseStreak} consecutive snapshots. ***`);
                    // groupIncreaseStreak = 0;
                }

            } else if (!newCounts) {
                console.warn('Skipping comparison due to missing new snapshot data.');
            } else { // Only previousCounts exists (first interval after successful initial snapshot)
                console.log(`[${new Date().toLocaleTimeString()}] Initial Counts - Geo: ${previousCounts.geometryCount}, Mat: ${previousCounts.materialCount}, Tex: ${previousCounts.textureCount}, RT: ${previousCounts.renderTargetCount}, Mesh: ${previousCounts.meshCount}, Grp: ${previousCounts.groupCount}`); // Added new types
            }
            // Update previousCounts for the next interval
            previousCounts = newCounts || previousCounts; // Keep old counts if new analysis failed
            console.log('--- Interval End ---');
        }, interval);

        // Keep the browser open while the interval is running
        // Cleanup logic needs to handle stopping the interval and closing the browser

        // The process will now stay alive due to the interval
        // await browser.close(); // Will be moved to cleanup logic

    } catch (error) {
        console.error('Error during browser operation:', error.message);
        if (browser) {
            await browser.close();
        }
        process.exit(1); // Exit if browser setup or navigation fails
    }
}

runWatchdog();

// Basic cleanup on exit
process.on('SIGINT', async () => {
    console.log('Received SIGINT. Closing browser...');
    // Add cleanup logic here if browser is accessible globally or passed around
    // Need to clear the interval and close the browser properly
    // For now, we rely on the main function's try/catch, but proper cleanup needed later
    process.exit(0);
});
