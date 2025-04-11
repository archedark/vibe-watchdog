// Contains the logic for taking a V8 heap snapshot via CDP

/**
 * Takes a heap snapshot using the provided CDP session.
 * Handles event listeners for chunks and progress, with timeouts.
 * @param {object} session - The Puppeteer CDP session.
 * @returns {Promise<string>} - A promise that resolves with the complete snapshot JSON string.
 * @throws {Error} - Throws an error if the snapshot times out or fails.
 */
async function takeSnapshot(session) {
    const SNAPSHOT_TIMEOUT_MS = 20000; // 20 seconds overall timeout
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
            // If finished has been reported, set a new timeout to finalize
            // If more chunks arrive, this timeout will be cleared and reset
            if (finishedReported) {
                quietPeriodTimeoutId = setTimeout(finalizeSnapshot, CHUNK_QUIET_PERIOD_MS);
            }
        };

        progressListener = (event) => {
            if (event.finished) {
                finishedReported = true;
                // Stop listening to progress once finished is reported
                if (progressListener) {
                     session.off('HeapProfiler.reportHeapSnapshotProgress', progressListener);
                     progressListener = null; // Ensure it's marked as removed
                }

                // Start the quiet period timeout now in case no more chunks arrive *at all*
                // or if they arrived before this 'finished' signal
                clearTimeout(quietPeriodTimeoutId); // Clear any previous just in case
                quietPeriodTimeoutId = setTimeout(finalizeSnapshot, CHUNK_QUIET_PERIOD_MS);
            }
        };

        session.on('HeapProfiler.addHeapSnapshotChunk', chunkListener);
        session.on('HeapProfiler.reportHeapSnapshotProgress', progressListener);

        try {
            await session.send('HeapProfiler.takeHeapSnapshot', { reportProgress: true, treatGlobalObjectsAsRoots: true }); // Added treatGlobalObjectsAsRoots
        } catch (err) {
            console.error('Error sending takeHeapSnapshot command:', err.message);
            cleanup();
            reject(err);
        }
    });
}

module.exports = { takeSnapshot };
