const express = require('express');
const path = require('path'); // Needed for serving static files and HTML
const cors = require('cors');
const http = require('http'); // Required for explicit server creation
const WebSocket = require('ws'); // Import WebSocket library
const url = require('url'); // To parse connection URL

// Import the delta calculation function
// Assuming analyzer.js is kept for legacy compatibility
const { calculateConstructorDelta } = require('./analyzer.js');

// Remove global instances, pass them into startServer
// let reportManagerInstance = null; 
// let appConfig = null; 
let latestReportCache = null; // Simple cache for the latest report

// --- WebSocket Handling Logic (Listen Mode) ---

let wss = null; // WebSocket server instance
const clients = new Set(); // Keep track of connected clients

// Pass reportManager instance into this function
function setupWebSocketServer(httpServer, config, reportManager) { 
    console.log(`Attempting to start WebSocket server on port ${config.listenWssPort}...`);
    // Use a separate port for WebSocket server
    wss = new WebSocket.Server({ port: config.listenWssPort });

    wss.on('connection', (ws, req) => {
        // Extract token from query parameter
        let token = null;
        try {
            // req.url might be undefined in some edge cases, handle gracefully
            const connectionUrl = req.url ? url.parse(req.url, true) : null;
            token = connectionUrl?.query?.token;
        } catch (e) {
             console.error('[WSS] Error parsing connection URL:', e);
             ws.terminate();
             return;
        }

        // Basic token validation (presence check)
        if (!token) {
            console.warn('[WSS] Connection attempt rejected: Missing token in query string (?token=...).');
            ws.terminate();
            return;
        }
        // TODO: Add more robust token validation if needed later
        console.log(`[WSS] Client connected with token: ${token.substring(0, 5)}...`);
        clients.add(ws);

        ws.on('message', async (message) => {
            let data;
            try {
                // Ensure message is a string before parsing (WebSocket messages can be Buffers)
                const messageString = message.toString();
                data = JSON.parse(messageString);

                if (data?.type === 'sceneCounts' && data.payload) {
                    // --- Adapt Payload --- 
                    const adaptedData = adaptClientPayload(data.payload);

                    // --- Calculate Delta --- 
                    const previousCounts = latestReportCache?.constructorCounts; // Get counts from cached latest report
                    const delta = calculateConstructorDelta(adaptedData.constructorCounts, previousCounts);

                    // --- Prepare Final Report --- 
                    const reportData = {
                        nodeCounts: adaptedData.nodeCounts,
                        constructorCounts: adaptedData.constructorCounts,
                        constructorCountsDelta: delta,
                        // timestamp will be added by saveReport based on filename logic
                    };
                    
                    // --- Save Report --- 
                    // Use the passed-in reportManager instance
                    await reportManager.saveReport(reportData, config.maxReports);
                    
                    // Update the cache *after* saving the new report
                    // Store the CONSTRUCTOR counts, as that's what delta needs
                    latestReportCache = { constructorCounts: adaptedData.constructorCounts };

                } else {
                    console.warn('[WSS] Received unknown message format or type:', data?.type);
                }

            } catch (e) {
                console.error('[WSS] Failed to parse message or process data:', e);
            }
        });

        ws.on('close', () => {
            console.log('[WSS] Client disconnected.');
            clients.delete(ws);
        });

        ws.on('error', (error) => {
            console.error('[WSS] WebSocket client error:', error);
            clients.delete(ws); // Remove on error too
        });

        // Optional: Send confirmation
        // ws.send(JSON.stringify({ type: 'connected', message: 'Welcome to Vibe Watchdog Local Listener!' }));
    });

    wss.on('error', (error) => {
        console.error('[WSS] WebSocket Server Error:', error);
        // Handle specific errors like EADDRINUSE if needed
        if (error.code === 'EADDRINUSE') {
            console.error(`[WSS] Error: Port ${config.listenWssPort} is already in use. Cannot start WebSocket server.`);
            // We might want to propagate this error back to watchdog.js to exit
            throw error; // Re-throw to be caught by startServer caller
        }
    });

    console.log(`[WSS] WebSocket server listening on port ${config.listenWssPort}`);
    return wss; // Return the instance
}

// --- Payload Adaptation Logic --- 
function adaptClientPayload(payload) {
    // Map relevant 'categories' to 'nodeCounts'
    const nodeCounts = {
        geometryCount: payload.categories?.Geometry ?? 0,
        materialCount: payload.categories?.Material ?? 0,
        textureCount: payload.categories?.Texture ?? 0,
        renderTargetCount: 0, // Not directly available from scene traversal easily
        meshCount: payload.categories?.Mesh ?? 0,
        groupCount: payload.categories?.Group ?? 0,
        // Add others if needed/available from categories
    };

    // Map constructor counts
    const constructorCounts = {
        threejs: payload.threejsConstructors || {},
        game: payload.userConstructors || {},
        misc: {} // Keep consistent with analyzer output structure
    };

    return { nodeCounts, constructorCounts };
}


// --- HTTP Server Logic --- 

// Accept initialized reportManager instance
async function startServer(config, reportManager, rootDir) { 
    // No longer need to store globally, use the passed-in instances
    // reportManagerInstance = reportManager; 
    // appConfig = config; 

    // Pre-fetch latest report for delta calculation priming using the passed instance
    try {
         const reports = await reportManager.getReports(); // Use passed instance
         if (reports && reports.length > 0) {
             // getReports already sorts newest first
             latestReportCache = reports[0];
         } else {
             latestReportCache = null; // Ensure cache is null if no reports
         }
    } catch (e) {
         console.warn('Could not pre-fetch latest report for delta cache:', e.message);
         latestReportCache = null;
    }

    const app = express();
    app.use(cors()); // Enable CORS for all routes

    // Serve static files (report-viewer.html, assets)
    app.use(express.static(rootDir));
    // Note: report-viewer.html fetches assets relative to itself, so serving rootDir is usually sufficient.
    // app.use('/reports', express.static(path.join(rootDir, 'reports'))); // Probably not needed

    // API endpoint to get report data - use passed reportManager
    app.get('/api/reports', async (req, res) => {
        try {
            const reportsData = await reportManager.getReports(); // Use passed instance
            res.json(reportsData);
        } catch (err) {
            console.error('/api/reports Error:', err);
            res.status(500).send('Error retrieving reports');
        }
    });

    // API endpoint to get config - use passed config
     app.get('/api/config', (req, res) => {
        // Viewer uses snapshotInterval to determine its polling frequency
        let effectiveInterval = config?.interval || 10000; // Default to legacy
        if (config?.isListenMode) {
            // Poll interval for the viewer in listen mode
            effectiveInterval = 5000; // Match the new client default (5 seconds)
        }
        
        res.json({
            snapshotInterval: effectiveInterval, // Report the effective interval
            maxReports: config?.maxReports,
        });
    });

    // Root redirects to the report viewer
    app.get('/', (req, res) => {
        res.redirect('/report-viewer.html');
    });

    // Create HTTP server explicitly to manage it
    const httpServer = http.createServer(app);
    let wssInstance = null;

    // Use Promise to handle async setup and potential errors
    return new Promise((resolve, reject) => {
        httpServer.listen(config.serverPort, () => {
            
            // Start WebSocket server ONLY if in listen mode
            if (config.isListenMode) {
                try {
                    // Pass the correct reportManager instance here
                    wssInstance = setupWebSocketServer(null, config, reportManager);
                } catch (wssError) {
                     console.error("Failed to start WebSocket server during HTTP listen callback:", wssError);
                     // Clean up HTTP server if WSS fails
                     httpServer.close(() => {
                         console.log('HTTP server shut down due to WebSocket startup failure.');
                     });
                     reject(wssError); // Reject the outer promise
                     return;
                }
            }
            resolve({ httpServer, wssServer: wssInstance }); // Resolve with server instances
        }).on('error', (err) => {
            console.error('HTTP Server Error:', err);
            if (err.code === 'EADDRINUSE') {
                console.error(`Error: Port ${config.serverPort} is already in use. Cannot start HTTP server.`);
            }
            reject(err); // Reject promise on HTTP server error
        });
    });
}

// Updated stopServer function
async function stopServer(serverObject) {
    // Ensure serverObject is valid
    if (!serverObject) {
        console.warn('stopServer called with invalid server object.');
        return;
    }
    
    const { httpServer, wssServer } = serverObject;
    let wssClosed = Promise.resolve(); // Promise that resolves immediately if no WSS
    let httpClosed = Promise.resolve(); // Promise for HTTP server closing

    if (wssServer) {
        console.log('Closing WebSocket server...');
        wssClosed = new Promise((resolve) => {
             // Close all client connections first
             console.log(`Disconnecting ${clients.size} WebSocket clients...`);
             clients.forEach(client => {
                 if (client.readyState === WebSocket.OPEN) {
                     client.terminate(); // Force close connections
                 }
             });
             clients.clear(); // Clear the set

            wssServer.close((err) => {
                if (err) {
                    console.error('Error closing WebSocket server:', err.message);
                } else {
                    console.log('WebSocket server closed.');
                }
                resolve(); // Resolve regardless of error for graceful shutdown
            });
        });
    }

    if (httpServer) {
        console.log('Closing HTTP server...');
        httpClosed = new Promise((resolve) => {
            httpServer.close((err) => {
                if (err) {
                    console.error('Error closing HTTP server:', err.message);
                } else {
                    console.log('HTTP server closed.');
                }
                resolve(); // Resolve regardless of error
            });
        });
    }

    // Wait for both servers to attempt closing
    await Promise.all([wssClosed, httpClosed]);
}


module.exports = { startServer, stopServer };
