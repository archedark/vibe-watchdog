const minimist = require('minimist');

// Default values
const DEFAULT_INTERVAL = 10000; // 10 seconds (Legacy Snapshot Interval)
const DEFAULT_THRESHOLD = 3;
const DEFAULT_MAX_REPORTS_LEGACY = 20;
const DEFAULT_MAX_REPORTS_LISTEN = 50; // New default for listen mode
const DEFAULT_SERVER_PORT = 1109;
const DEFAULT_HEADLESS = false;
const DEFAULT_AGENT_MODE = false; // Keep for reference, but maybe remove later
const DEFAULT_INSPECTOR_PORT = 9229; // Keep for reference
const DEFAULT_BACKEND_URL = 'wss://your-vibe-watchdog-backend.com'; // Keep for reference
const DEFAULT_LISTEN_MODE = false;
const DEFAULT_LISTEN_WSS_PORT = 1110; // Default port for local WebSocket server
const DEFAULT_CLEAR_REPORTS_LISTEN = true; // Default for listen mode
const DEFAULT_CLEAR_REPORTS_LEGACY = false; // Default for legacy mode

function showHelp() {
    console.log(`
Usage:
  Legacy Mode: node watchdog.js --url <your-game-url> [options]
  Listen Mode: node watchdog.js --listen [options]
  (Agent Mode via Inspector Protocol is deprecated/removed)

Common Options:
  --max-reports <num>  Max number of JSON reports to keep locally.
                       (Default: ${DEFAULT_MAX_REPORTS_LEGACY} for Legacy, ${DEFAULT_MAX_REPORTS_LISTEN} for Listen).
  --port <num>         Port for the local report viewer HTTP server. Default: ${DEFAULT_SERVER_PORT}.
  --clear-reports      Delete existing local reports before starting.
                       (Default: ${DEFAULT_CLEAR_REPORTS_LEGACY} for Legacy, ${DEFAULT_CLEAR_REPORTS_LISTEN} for Listen). Pass --no-clear-reports to disable.
  --help               Show this help message and exit.

Legacy Mode Options (--url required):
  --url <url>          REQUIRED: The URL of the web page/game to monitor via Puppeteer.
  --headless           Run Puppeteer in headless mode. Default: ${DEFAULT_HEADLESS}.
  --interval <ms>      Interval (ms) between heap snapshots. Default: ${DEFAULT_INTERVAL}ms.
  --threshold <count>  Number of consecutive increases to trigger legacy leak warning. Default: ${DEFAULT_THRESHOLD}.

Listen Mode Options (--listen required):
  --listen             Run in listen mode: Starts the HTTP server and a WebSocket server to accept data from a @vibewatchdog/client library instance.
  --wss-port <port>    Port for the local WebSocket server to listen on. Default: ${DEFAULT_LISTEN_WSS_PORT}.
    `);
    process.exit(0);
}

function getConfig() {
    // Use minimist options to correctly handle boolean flags like --no-clear-reports
    const args = minimist(process.argv.slice(2), {
        boolean: ['help', 'headless', 'listen', 'clear-reports']
    });

    if (args.help) {
        showHelp();
    }

    const isAgentMode = args.agent || DEFAULT_AGENT_MODE; // Still parsing for now, but unused
    const isListenMode = args.listen; // Use parsed boolean directly

    // Determine maxReports default based on mode
    const defaultMaxReports = isListenMode ? DEFAULT_MAX_REPORTS_LISTEN : DEFAULT_MAX_REPORTS_LEGACY;
    const maxReports = args['max-reports'] || defaultMaxReports;

    // Determine clearReports default based on mode
    let clearReports;
    // Check if the user explicitly provided --clear-reports or --no-clear-reports in the raw arguments
    const clearReportsFlagProvided = process.argv.some(arg => arg === '--clear-reports' || arg === '--no-clear-reports');
    
    if (clearReportsFlagProvided) {
        // User explicitly provided the flag, use the value parsed by minimist (which respects --no-...)
        clearReports = args['clear-reports']; 
    } else {
        // Flag was omitted, apply mode-specific default
        clearReports = isListenMode ? DEFAULT_CLEAR_REPORTS_LISTEN : DEFAULT_CLEAR_REPORTS_LEGACY;
    }
    
    // Common Configuration
    const serverPort = args.port || DEFAULT_SERVER_PORT;
    // const clearReports = args['clear-reports'] || defaultClearReports; // Old logic replaced
    const listenWssPort = args['wss-port'] || DEFAULT_LISTEN_WSS_PORT;

    // Legacy Mode Configuration
    const targetUrl = args.url;
    const isHeadless = args.headless; // Use parsed boolean directly
    const interval = args.interval || DEFAULT_INTERVAL; // Legacy interval
    const threshold = args.threshold || DEFAULT_THRESHOLD; // Legacy threshold

    // --- Validation --- 
    if (isListenMode && targetUrl) {
        console.error('Error: --listen and --url are mutually exclusive.');
        showHelp();
    }
    if (isListenMode && (args.headless !== DEFAULT_HEADLESS || args.interval || args.threshold)) {
        // Check if headless was explicitly passed, not just its default value
        if (args.headless !== undefined) console.warn('Warning: --headless is ignored in --listen mode.');
        if (args.interval) console.warn('Warning: --interval is ignored in --listen mode.');
        if (args.threshold) console.warn('Warning: --threshold is ignored in --listen mode.');
    }
    if (!isListenMode && !targetUrl) {
        console.error('Error: Either --url (for legacy mode) or --listen (for listen mode) must be provided.');
        showHelp();
    }
    // --- End Validation --- 


    // Return relevant config based on mode
    if (isListenMode) {
        return {
            isListenMode: true,
            isAgentMode: false,
            maxReports,
            serverPort, // HTTP port
            clearReports,
            listenWssPort // WebSocket port
        };
    } else {
        // Legacy Mode
        return {
            isListenMode: false,
            isAgentMode: false,
            targetUrl,
            isHeadless,
            interval,
            threshold,
            maxReports,
            serverPort,
            clearReports,
            listenWssPort: null // Not used in legacy mode
        };
    }

    // Original structure (kept for reference during refactor, can remove later)
    /*
    return {
        // Mode
        isAgentMode,

        // Agent specific
        apiToken,
        inspectorPort,
        backendUrl,

        // Legacy specific
        targetUrl,
        isHeadless,
        maxReports,
        serverPort,
        clearReports,

        // Common
        interval,
        threshold,
    };
    */
}

module.exports = getConfig;
