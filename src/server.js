const express = require('express');
const path = require('path'); // Needed for serving static files and HTML

function startServer(config, reportManager, baseDir) {
    const app = express();

    // --- Static files and HTML --- 
    app.get('/', (req, res) => {
        // Use baseDir to construct the path to report-viewer.html
        res.sendFile(path.join(baseDir, 'report-viewer.html')); 
    });

    app.use('/assets', express.static(path.join(baseDir, 'assets')));

    // --- API Routes ---
    app.get('/api/reports', async (req, res) => {
        try {
            const reportsData = await reportManager.getReports();
            res.json(reportsData);
        } catch (err) {
            // Log the error but let ReportManager handle specifics
            console.error('Error serving reports via API:', err.message);
            res.status(500).send('Error retrieving reports');
        }
    });

    app.get('/api/config', (req, res) => {
        res.json({
            snapshotInterval: config.interval // Use interval from config
        });
    });

    // --- Start Listening ---
    const server = app.listen(config.serverPort, () => {
        console.log(`Report viewer available at http://localhost:${config.serverPort}`);
    });

    server.on('error', (err) => {
        console.error(`Server error: ${err.message}`);
        // Optional: Implement more robust error handling, e.g., attempt restart or shutdown
        // For now, just log it. Watchdog might continue running depending on the error.
    });

    return server; // Return the server instance for potential cleanup
}

function stopServer(server) {
    return new Promise((resolve) => {
        if (server) {
            console.log('Closing report viewer server...');
            server.close(() => {
                console.log('Report viewer server closed.');
                resolve();
            });
        } else {
            resolve(); // Nothing to close
        }
    });
}

module.exports = { startServer, stopServer };
