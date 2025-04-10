const minimist = require('minimist');

// Default values
const DEFAULT_INTERVAL = 10000; // 10 seconds
const DEFAULT_THRESHOLD = 3;
const DEFAULT_MAX_REPORTS = 20;
const DEFAULT_SERVER_PORT = 1109;
const DEFAULT_HEADLESS = false;

function showHelp() {
    console.log(`
Usage: node watchdog.js --url <your-game-url> [options]

Options:
  --url <url>          REQUIRED: The URL of the web page/game to monitor.
  --headless           Run Puppeteer in headless mode (no visible browser window). Default: ${DEFAULT_HEADLESS}.
  --interval <ms>      The interval (in milliseconds) between heap snapshots. Default: ${DEFAULT_INTERVAL}ms.
  --threshold <count>  The number of consecutive increases in a resource count to trigger a potential leak warning. Default: ${DEFAULT_THRESHOLD}.
  --max-reports <num>  The maximum number of JSON reports to keep in the reports directory. Default: ${DEFAULT_MAX_REPORTS}.
  --port <num>         The port number for the report viewer web server. Default: ${DEFAULT_SERVER_PORT}.
  --clear-reports      Delete all existing reports in the 'reports' directory before starting. Default: false.
  --help               Show this help message and exit.
    `);
    process.exit(0);
}

function getConfig() {
    const args = minimist(process.argv.slice(2));

    if (args.help) {
        showHelp();
    }

    const targetUrl = args.url;
    const isHeadless = args.headless || DEFAULT_HEADLESS;
    const interval = args.interval || DEFAULT_INTERVAL;
    const threshold = args.threshold || DEFAULT_THRESHOLD;
    const maxReports = args['max-reports'] || DEFAULT_MAX_REPORTS;
    const serverPort = args.port || DEFAULT_SERVER_PORT;
    const clearReports = args['clear-reports'] || false;

    if (!targetUrl) {
        console.error('Error: --url parameter is required.');
        console.log('Usage: node watchdog.js --url <your-game-url> [--headless] [--interval <ms>] [--threshold <count>] [--max-reports <num>] [--port <num>] [--clear-reports]');
        process.exit(1);
    }

    return {
        targetUrl,
        isHeadless,
        interval,
        threshold,
        maxReports,
        serverPort,
        clearReports
    };
}

module.exports = getConfig;
