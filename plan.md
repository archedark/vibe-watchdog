After implementing any steps in this plan, be sure to mark them as complete: [X].
Also update any future steps with substeps and/or refinement based on what you implemented (if necessary). 

# Memory Watchdog MVP Plan (Node.js + Puppeteer)

This document outlines the steps to build a Minimum Viable Product (MVP) of a memory watchdog tool for Three.js applications, designed to run externally using Node.js and Puppeteer to automate Chrome and leverage the DevTools protocol for heap analysis.

**Goal:** Create a simple command-line tool that launches the game, periodically takes heap snapshots, compares basic object counts between snapshots, and alerts the user via the console if counts consistently increase (suggesting a potential leak).

**Technology:** Node.js, Puppeteer library.

**Usage & Configuration (MVP):**

The tool will be run from the command line:

```bash
node watchdog.js --url <your-game-url> [--headless] [--interval <ms>] [--threshold <count>]
```

*   `--url` (Required): The URL of the Three.js application to monitor.
*   `--headless` (Optional): Runs Chrome in headless mode (no visible UI window). Defaults to `false` for easier initial debugging.
*   `--interval` (Optional): The interval in milliseconds between heap snapshots. Defaults to `30000` (30 seconds).
*   `--threshold` (Optional): The number of consecutive increases needed to trigger a leak warning. Defaults to `3`.

**Steps:**

1.  **Project Setup:**
    [X] Create a new directory for the tool (e.g., `vibe-watchdog`).
    [X] Navigate into the directory: `cd vibe-watchdog`
    [X] Initialize a Node.js project: `npm init -y`
    [X] Install Puppeteer: `npm install puppeteer`
    [X] Install `minimist`: `npm install minimist`
    [X] Create the main script file (e.g., `watchdog.js`).

2.  **Launch Browser & Navigate:**
    [X] In `watchdog.js`, require Puppeteer and potentially an argument parser.
    [X] Parse command-line arguments to get the target `url` and `headless` mode preference. Validate that `--url` is provided.
    [X] Write an async function to launch a new Chrome instance (`puppeteer.launch({ headless: isHeadlessMode })`).
    [X] Create a new page (`browser.newPage()`).
    [X] Navigate the page to the provided target `url`.
    [X] Add basic error handling (e.g., if the URL is invalid or the page fails to load).
    [X] Log an initial message indicating the tool has started and warning about the simplified MVP analysis method (e.g., `console.warn('Watchdog started. Using simplified analysis for MVP - results may be inaccurate.')`).

3.  **Connect to DevTools Protocol (CDP):**
    [X] Get the CDP session object from the page: `const cdpSession = await page.target().createCDPSession();`
    [X] Enable the `HeapProfiler` domain: `await cdpSession.send('HeapProfiler.enable');`

4.  **Take Initial Heap Snapshot:**
    [X] Define an async function `takeSnapshot(cdpSession)` that:
        [X] Sends the command to take a snapshot: `await cdpSession.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });`
        [X] **Note:** Retrieving the actual snapshot data is more complex (handled in Step 6). For now, just triggering it is enough to establish the process.

5.  **Implement Snapshot Interval:**
    [X] Use `setInterval` within your main async function (after the page loads).
    [X] Use the configured snapshot interval (from command-line args or default).
    [X] Call the snapshot taking and analysis logic within the interval callback.
    [X] Keep track of previous snapshot analysis results (e.g., object counts) in variables accessible within the interval scope.

6.  **Retrieve Snapshot Data:**
    [X] Modify `takeSnapshot` to handle data retrieval. The snapshot is streamed in chunks.
    [X] Create a way to accumulate these chunks. Attach a listener *before* calling `takeHeapSnapshot`:
        ```javascript
        let snapshotData = '';
        cdpSession.on('HeapProfiler.addHeapSnapshotChunk', chunkEvent => {
            snapshotData += chunkEvent.chunk;
        });
        // Listener for progress/completion added
        await cdpSession.send('HeapProfiler.takeHeapSnapshot', { reportProgress: true });
        ```
    [X] Return the complete `snapshotData` string (which is stringified JSON).

7.  **Basic Snapshot Parsing:**
    [X] Create a function `analyzeSnapshot(snapshotJsonString)`:
        [X] Parse the JSON: `const snapshot = JSON.parse(snapshotJsonString);`
        [X] Navigate the snapshot structure (requires understanding the `.heapsnapshot` format - specifically the `nodes` and `strings` arrays) to count instances of specific Three.js objects.
        [X] **MVP Simplification:** Instead of full parsing, use string searching on the JSON string for MVP: `snapshotJsonString.match(/BufferGeometry/g)?.length || 0`. This is **highly inaccurate** but serves as a placeholder for the MVP. *Replace with proper parsing later.*
        [X] Return an object with counts: `{ geometryCount: count1, materialCount: count2, textureCount: count3 }`

8.  **Comparison Logic:**
    [X] In the `setInterval` callback:
        [X] Take the new snapshot and analyze it to get `newCounts`.
        [X] Compare `newCounts` with `previousCounts` (stored from the last interval).
        [X] Update `previousCounts = newCounts`.

9.  **Basic Leak Detection Heuristic:**
    [X] Maintain state variables (e.g., `geometryIncreaseStreak = 0`).
    [X] If `newCounts.geometryCount > previousCounts.geometryCount`, increment the streak.
    [X] If `newCounts.geometryCount <= previousCounts.geometryCount`, reset the streak to 0.
    [X] If `geometryIncreaseStreak` reaches the configured threshold (from command-line args or default), trigger an alert.
    [X] Apply similar logic for materials, textures.

10. **Console Output & Alerting:**
    [X] After each snapshot is analyzed (in the `setInterval` callback), log the counts: `console.log(\`[${new Date().toLocaleTimeString()}] Snapshot: Geometries: ${newCounts.geometryCount}, Materials: ${newCounts.materialCount}, Textures: ${newCounts.textureCount}\`);`
    [X] When the heuristic threshold is met, print a warning to the Node.js console: `console.warn(\`Potential Geometry Leak Detected! Count increased for ${config.threshold} consecutive snapshots.\`);` (Adapt for other types).

11. **Cleanup:**
    [X] Ensure the browser is closed (`browser.close()`) when the script exits or is interrupted (e.g., using `process.on('SIGINT', ...)`).
    [ ] Create a basic `README.md` explaining the usage described above.

**Next Steps (Post-MVP):**

[X] **Robust Snapshot Parsing:** Implement proper navigation of the snapshot graph structure for accurate object counting.
    [X] **Goal:** Replace the inaccurate MVP string search in `analyzeSnapshot` with analysis based on the actual heap graph.
    [X] **Sub-Steps:**
        [X] Parse the snapshot JSON string (`JSON.parse`).
        [X] Validate the structure (`snapshot.nodes`, `snapshot.edges`, `snapshot.strings`).
        [X] Efficiently map string indices to strings (e.g., build a Map or access `snapshot.strings` directly).
        [X] Iterate through `snapshot.nodes`.
        [X] For each `node`, determine its constructor name via `snapshot.strings[node.name]`.
        [X] If the constructor name matches a target type (e.g., 'BufferGeometry', 'Mesh', 'WebGLRenderTarget', 'Material', 'Texture', 'Group', consider subtypes later), increment an accurate counter for that type.
        [ ] **Refinement:** Aggregate `node.self_size` and `node.retained_size` for each tracked type during iteration. This provides much more valuable data than just counts.
        [X] Modify `analyzeSnapshot` to return the object with accurate counts and potentially aggregated sizes.
[ ] **Advanced Heuristics:** Analyze retained sizes, identify detached objects.
    [ ] **Goal:** Use the `retained_size` information gathered during parsing to detect potentially leaked objects more effectively than just relying on count increases.
[ ] **Source Mapping:** If possible, try to map leaks back to specific parts of the game code (very complex).
[ ] **User Interface:** Create a simple web UI (using Express, etc.) or a DevTools extension panel instead of just console logs.
[ ] **Advanced Configuration:** Allow configuration of specific object types to track via command line or a config file.
[ ] **Error Handling:** Add more robust error handling for Puppeteer and CDP interactions.