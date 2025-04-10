const puppeteer = require('puppeteer');
const getConfig = require('./src/config.js'); // Import the config module
const ReportManager = require('./src/report-manager.js'); // Require ReportManager
const fs = require('fs').promises; // Added for file system operations
const path = require('path'); // Added for path manipulation
const express = require('express'); // Add Express

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
    const app = express(); // Create Express app
    let server; // Declare server variable for later cleanup
    let browser;
    let intervalId; // Declare intervalId for cleanup

    // --- Web Server Setup ---
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'report-viewer.html'));
    });

    // --- Serve static assets (like the logo) ---
    app.use('/assets', express.static(path.join(__dirname, 'assets')));

    // Function to extract timestamp from filename (consistent with manageReports)
    function getTimestampFromFilename(filename) {
        // filename format: report-YYYY-MM-DDTHH-MM-SSZ.json
        const timestampPart = filename.substring(7, filename.length - 5); // e.g., "YYYY-MM-DDTHH-MM-SSZ"
        // Restore colons in the time part: HH-MM-SS -> HH:MM:SS
        // Ensure T separator is present
        const isoTimestamp = timestampPart.substring(0, 10) + 'T' + timestampPart.substring(11).replace(/-/g, ':');
        // Now isoTimestamp should be "YYYY-MM-DDTHH:MM:SSZ" which is valid ISO 8601
        const date = new Date(isoTimestamp);
        if (isNaN(date.getTime())) { // Check if parsing failed
            console.warn(`Failed to parse timestamp from filename: ${filename} (Constructed ISO: ${isoTimestamp})`);
            return null; // Return null to indicate failure
        }
        return date.getTime(); // Return milliseconds since epoch
    }


    app.get('/api/reports', async (req, res) => {
        try {
            const reportsData = await reportManager.getReports(); // Use ReportManager method
            res.json(reportsData);
        } catch (err) {
            console.error('Error serving reports:', err.message);
            res.status(500).send('Error retrieving reports');
        }
    });

    // --- Add config endpoint --- (Update to use config object)
    app.get('/api/config', (req, res) => {
        res.json({
            snapshotInterval: config.interval // Expose the interval value from config
        });
    });

    // --- End Web Server Setup ---


    try {
        // --- Initialize Report Directory ---
        await reportManager.initializeDirectory();

        // --- Clear Reports Logic (using ReportManager) ---
        if (config.clearReports) {
            console.log('--clear-reports flag detected.'); // Log simplified message
            await reportManager.clearReports();
        }
        // --- End Clear Reports Logic ---

        // Report directory creation is handled by ReportManager.initializeDirectory()

        // Start the server *before* launching Puppeteer
        server = app.listen(config.serverPort, () => {
             console.log(`Report viewer available at http://localhost:${config.serverPort}`);
        });
        server.on('error', (err) => {
            console.error(`Server error: ${err.message}`);
            // Decide how to handle server errors (e.g., exit or just log)
            // For now, log and let watchdog continue if possible
        });

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

        // Step 7: Robust Snapshot Parsing (Graph Traversal + Constructor Finding)
        function analyzeSnapshot(snapshotJsonString) {
            console.log('Analyzing snapshot using graph traversal + constructor analysis...');
            // Initialize counts based on node names
            let counts = {
                geometryCount: 0, materialCount: 0, textureCount: 0,
                renderTargetCount: 0, meshCount: 0, groupCount: 0
            };
            // Initialize counts based on constructor property analysis - now categorized
            let threejsConstructorCounts = {}; 
            let gameConstructorCounts = {};
            let miscConstructorCounts = {}; // Keep for future use
            
            if (!snapshotJsonString) {
                console.warn('Cannot analyze empty snapshot data.');
                return counts; 
            }

            let loggedNodesCount = 0;
            const MAX_NODES_TO_LOG = 10; 

            // --- Target Type Definitions (Unchanged) --- 
            const typeToCountKey = {
                'BufferGeometry': 'geometryCount',
                'Material': 'materialCount',
                'Texture': 'textureCount',
                'WebGLRenderTarget': 'renderTargetCount',
                'Mesh': 'meshCount',
                'Group': 'groupCount'
            };
            const exactTargetTypeSet = new Set(['BufferGeometry', 'Mesh', 'Group']);
            const broadTypeToCountKey = {
                'Material': 'materialCount',
                'Texture': 'textureCount',
                'WebGLRenderTarget': 'renderTargetCount'
            };
            const broadExclusions = {
                'Material': ['Loader', 'Definition', 'Creator'],
                'Texture': ['Loader', 'Encoding']
            };
            // We still need the set of types we care about for constructor analysis target
            const reportPropertiesForTypes = new Set(Object.keys(typeToCountKey)); 

            // --- Filtering Sets for Constructor Analysis (Re-inserting definitions) --- 
            const knownThreejsTypes = new Set([
                'Scene', 'Object3D', 'Mesh', 'Group', 'SkinnedMesh', 'InstancedMesh', 'BatchedMesh', 'LOD', 
                'Points', 'Line', 'LineLoop', 'LineSegments', 'Sprite',
                'BufferGeometry', 'InstancedBufferGeometry', 'BoxGeometry', 'CapsuleGeometry', 'CircleGeometry', 'ConeGeometry', 
                'CylinderGeometry', 'DodecahedronGeometry', 'EdgesGeometry', 'ExtrudeGeometry', 'IcosahedronGeometry',
                'LatheGeometry', 'OctahedronGeometry', 'PlaneGeometry', 'PolyhedronGeometry', 'RingGeometry', 
                'ShapeGeometry', 'SphereGeometry', 'TetrahedronGeometry', 'TorusGeometry', 'TorusKnotGeometry', 
                'TubeGeometry', 'WireframeGeometry', 'Shape', 'Path', 
                'Material', 'LineBasicMaterial', 'LineDashedMaterial', 'MeshBasicMaterial', 'MeshDepthMaterial', 
                'MeshDistanceMaterial', 'MeshLambertMaterial', 'MeshMatcapMaterial', 'MeshNormalMaterial', 
                'MeshPhongMaterial', 'MeshPhysicalMaterial', 'MeshStandardMaterial', 'MeshToonMaterial', 
                'PointsMaterial', 'RawShaderMaterial', 'ShaderMaterial', 'ShadowMaterial', 'SpriteMaterial',
                'Texture', 'CanvasTexture', 'CompressedArrayTexture', 'CompressedCubeTexture', 'CompressedTexture',
                'CubeTexture', 'Data3DTexture', 'DataArrayTexture', 'DataTexture', 'DepthTexture', 'FramebufferTexture',
                'VideoTexture',
                'WebGLRenderTarget', 'WebGLCubeRenderTarget', 'WebGLArrayRenderTarget', 
                'Light', 'AmbientLight', 'DirectionalLight', 'HemisphereLight', 'LightProbe', 'PointLight', 
                'RectAreaLight', 'SpotLight', 'LightShadow', 'DirectionalLightShadow', 'PointLightShadow', 'SpotLightShadow',
                'Camera', 'ArrayCamera', 'OrthographicCamera', 'PerspectiveCamera', 'StereoCamera', 'CubeCamera',
                'Audio', 'AudioListener', 'PositionalAudio',
                'AnimationClip', 'AnimationMixer', 'AnimationAction', 'AnimationObjectGroup', 'KeyframeTrack',
                'BooleanKeyframeTrack', 'ColorKeyframeTrack', 'NumberKeyframeTrack', 'QuaternionKeyframeTrack', 'StringKeyframeTrack', 'VectorKeyframeTrack',
                'Raycaster', 'Layers', 'Clock', 'EventDispatcher' 
            ]);
            const jsBuiltIns = new Set([
                'Object', 'Array', 'Function', 'String', 'Number', 'Boolean', 'Symbol', 'Date', 
                'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError', 
                'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 
                'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'JSON', 'Math', 'Reflect',
                'Intl', 'Collator', 'DateTimeFormat', 'ListFormat', 'NumberFormat', 'PluralRules', 'RelativeTimeFormat', 'Locale',
                'AggregateError', 'FinalizationRegistry', 'WeakRef', 'Iterator', 'AsyncIterator', 
                'GeneratorFunction', 'AsyncFunction', 'AsyncGeneratorFunction', 'InternalError', 'SuppressedError',
                'DisposableStack', 'AsyncDisposableStack', 
                'CompileError', 'LinkError', 'RuntimeError', 'TypedArray',
                'BigInt', 'DisplayNames', 'DurationFormat', 'Segmenter', "GLTFBinaryExtension", "GLTFCubicSplineInterpolant", "GLTFCubicSplineQuaternionInterpolant", "GLTFDracoMeshCompressionExtension", "GLTFLightsExtension", "GLTFMaterialsAnisotropyExtension", "GLTFMaterialsBumpExtension", "GLTFMaterialsClearcoatExtension", "GLTFMaterialsEmissiveStrengthExtension", "GLTFMaterialsIorExtension", "GLTFMaterialsIridescenceExtension", "GLTFMaterialsSheenExtension", "GLTFMaterialsSpecularExtension", "GLTFMaterialsTransmissionExtension", "GLTFMaterialsUnlitExtension", "GLTFMaterialsVolumeExtension", "GLTFMeshGpuInstancing", "GLTFMeshQuantizationExtension", "GLTFMeshoptCompression", "GLTFParser", "GLTFRegistry", "GLTFTextureAVIFExtension", "GLTFTextureBasisUExtension", "GLTFTextureTransformExtension", "GLTFTextureWebPExtension",
            ]);
            const webglInternalsExclude = new Set([
                'WebGLRenderingContext', 'WebGL2RenderingContext', 'WebGLActiveInfo', 'WebGLBuffer', 
                'WebGLContextEvent', 'WebGLFramebuffer', 'WebGLProgram', 'WebGLQuery', 'WebGLRenderbuffer', 
                'WebGLSampler', 'WebGLShader', 'WebGLShaderPrecisionFormat', 'WebGLSync', 'WebGLTransformFeedback', 
                'WebGLUniformLocation', 'WebGLVertexArrayObject', 'WebGLTexture',
                'OESTextureFloatLinear',
                'WebGLAnimation', 'WebGLAttributes', 'WebGLBackground', 'WebGLBindingStates', 'WebGLBufferRenderer', 
                'WebGLCapabilities', 'WebGLClipping', 'WebGLCubeMaps', 'WebGLCubeUVMaps', 'WebGLExtensions', 
                'WebGLGeometries', 'WebGLIndexedBufferRenderer', 'WebGLInfo', 'WebGLMaterials', 'WebGLMorphtargets', 
                'WebGLMultipleRenderTargets', 'WebGLObject', 'WebGLObjects', 'WebGLPrograms', 'WebGLProperties', 
                'WebGLRenderLists', 'WebGLRenderStates', 'WebGLRenderer', 'WebGL1Renderer', 'WebGLShaderCache', 
                'WebGLShadowMap', 'WebGLState', 'WebGLTextures', 'WebGLUniforms', 'WebGLUniformsGroups', 'WebGLUtils',
                'Uniform', 'SingleUniform', 'PureArrayUniform', 'StructuredUniform', 'UniformsGroup', 
                'PropertyBinding', 'PropertyMixer', 'ImageUtils', 'PMREMGenerator', 'WebXRManager', 'WebXRController',
                'WebGLShaderStage', 'WebGLCubeRenderTarget', 'WebGLArrayRenderTarget', 'WebGL3DRenderTarget' 
            ]);
            const browserApiExcludes = new Set([
                'Window', 'Event', 'CustomEvent', 'UIEvent', 'MouseEvent', 'KeyboardEvent', 'TouchEvent', 'PointerEvent',
                'MessageChannel', 'MessageEvent', 'MessagePort', 'XMLHttpRequest', 'URL', 'URLSearchParams', 
                'Location', 'History', 'Navigator', 'Performance', 'Console', 'Worker', 'SharedWorker', 
                'WebSocket', 'ReadableStream', 'ReadableStreamDefaultController', 'ReadableStreamDefaultReader',
                'Headers', 'Request', 'Response', 'Blob', 'ImageData', 'ImageBitmap', 'OffscreenCanvas',
                'OffscreenCanvasRenderingContext2D', 'CanvasRenderingContext2D', 'CanvasGradient',
                'AudioContext', 'BaseAudioContext', 'AudioNode', 'AudioParam', 'AudioBuffer', 'AudioDestinationNode', 'GainNode', 
                'ProgressEvent', 'BroadcastChannel', 'Lock', 'LockManager', 'MediaQueryList', 'Storage',
                'AbortController', 'AbortSignal', 'AudioBufferSourceNode', 'AudioScheduledSourceNode', 'DOMException', 
                'EventTarget', 'TextDecoder'
            ]);
            const domExcludes = new Set([
                 'Node', 'Element', 'Document', 'CharacterData', 'Text', 'HTMLElement', 'HTMLCollection', 'NodeList', 
                 'DOMRect', 'DOMRectReadOnly', 'DOMStringMap', 'DOMTokenList',
                 'HTMLBodyElement', 'HTMLButtonElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLDocument', 
                 'HTMLHeadElement', 'HTMLHeadingElement', 'HTMLIFrameElement', 'HTMLImageElement', 'HTMLInputElement', 
                 'HTMLLinkElement', 'HTMLScriptElement', 'HTMLStyleElement', 
                 'CSSStyleDeclaration'
            ]);
            const threeHelpersExclude = new Set([
                'ArrowHelper', 'AxesHelper', 'BoxHelper', 'Box3Helper', 'CameraHelper', 'DirectionalLightHelper',
                'GridHelper', 'HemisphereLightHelper', 'PlaneHelper', 'PointLightHelper', 'PolarGridHelper', 
                'SkeletonHelper', 'SpotLightHelper'
            ]);
            const threeLoadersExclude = new Set([
                'AnimationLoader', 'AudioLoader', 'BufferGeometryLoader', 'CompressedTextureLoader', 'CubeTextureLoader',
                'DataTextureLoader', 'FileLoader', 'ImageLoader', 'ImageBitmapLoader', 'Loader', 'LoaderUtils',
                'MaterialLoader', 'ObjectLoader', 'TextureLoader', 'GLTFLoader'
            ]);
            const threeMathExclude = new Set([
                'Box2', 'Box3', 'Color', 'ColorKeyframeTrack', 'Cylindrical', 'Euler', 'Frustum', 'Interpolant',
                'CubicInterpolant', 'DiscreteInterpolant', 'LinearInterpolant', 'QuaternionLinearInterpolant', 
                'Line3', 'Matrix3', 'Matrix4', 'Plane', 'Quaternion', 'Ray', 'Sphere', 'Spherical', 
                'SphericalHarmonics3', 'Triangle', 'Vector2', 'Vector3', 'Vector4'
            ]);
            const threeCurvesExclude = new Set([
                'ArcCurve', 'CatmullRomCurve3', 'CubicBezierCurve', 'CubicBezierCurve3', 'Curve', 'CurvePath',
                'EllipseCurve', 'LineCurve', 'LineCurve3', 'Path', 'QuadraticBezierCurve', 'QuadraticBezierCurve3',
                'Shape', 'ShapePath', 'SplineCurve'
            ]);
            const typedArrayAndAttributesExclude = new Set([
                'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 
                'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
                'Float16Array',
                'BufferAttribute', 'GLBufferAttribute', 'InstancedBufferAttribute', 'InterleavedBufferAttribute',
                'Float16BufferAttribute', 'Float32BufferAttribute', 'Float64BufferAttribute',
                'Int8BufferAttribute', 'Int16BufferAttribute', 'Int32BufferAttribute',
                'Uint8BufferAttribute', 'Uint16BufferAttribute', 'Uint32BufferAttribute', 'Uint8ClampedBufferAttribute'
            ]);
            const otherLibsExclude = new Set([
                'GoTrueAdminApi', 'GoTrueClient', 'SupabaseAuthClient', 'SupabaseClient', 
                'AuthApiError', 'AuthError', 'AuthImplicitGrantRedirectError', 'AuthInvalidCredentialsError',
                'AuthInvalidJwtError', 'AuthInvalidTokenResponseError', 'AuthPKCEGrantCodeExchangeError', 
                'AuthRetryableFetchError', 'AuthSessionMissingError', 'AuthUnknownError', 'AuthWeakPasswordError',
                'CustomAuthError',
                'PostgrestBuilder', 'PostgrestClient', 'PostgrestError', 'PostgrestFilterBuilder', 
                'PostgrestQueryBuilder', 'PostgrestTransformBuilder',
                'StorageApiError', 'StorageBucketApi', 'StorageClient', 'StorageError', 'StorageFileApi', 'StorageUnknownError',
                'RealtimeChannel', 'RealtimeClient', 'RealtimePresence', 'Timer', 'Serializer', 'Push',
                'FunctionsClient', 'FunctionsError', 'FunctionsFetchError', 'FunctionsHttpError', 'FunctionsRelayError',
                'Source', 'HttpError', 'Exception', 'Deferred', 'EventEmitter', 'WebSocketClient', 'WSWebSocketDummy',
                'WebpackLogger', 'clientTapableSyncBailHook', 
                'CallSite', 'Global', 'Instance', 'Memory', 'Module', 'Table', 'Tag', 'ScriptWrappableTaskState',
                '_'
            ]);

            // --- ADD THIS SET for manual exclusions ---
            const manualMiscExcludes = new Set([
                "AudioAnalyser", "ClearMaskPass", "Composite", "FullScreenQuad", "FullscreenTriangleGeometry",  "InstancedInterleavedBuffer", "InterleavedBuffer", "LockAcquireTimeoutError", "MultiDrawRenderList", "NavigatorLockAcquireTimeoutError", "ProcessLockAcquireTimeoutError"
            ]);

            try {
                const snapshot = JSON.parse(snapshotJsonString);

                // --- Validate Snapshot Structure (Unchanged) --- 
                if (!snapshot?.nodes || !snapshot.edges || !snapshot.strings || 
                    !snapshot.snapshot?.meta?.node_fields || !snapshot.snapshot.meta.edge_fields || 
                    !snapshot.snapshot.meta.node_types?.[0] || !snapshot.snapshot.meta.edge_types?.[0] ||
                    !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges) || !Array.isArray(snapshot.strings) ||
                    !Array.isArray(snapshot.snapshot.meta.node_fields) || !Array.isArray(snapshot.snapshot.meta.edge_fields) ||
                    !Array.isArray(snapshot.snapshot.meta.node_types[0]) || !Array.isArray(snapshot.snapshot.meta.edge_types[0])) {
                    console.warn('Snapshot JSON parsed, but essential structure (nodes, edges, strings, meta) not found or invalid.');
                    return counts;
                }

                const nodes = snapshot.nodes;
                const edges = snapshot.edges;
                const strings = snapshot.strings;
                const meta = snapshot.snapshot.meta;
                const nodeFields = meta.node_fields;
                const nodeFieldCount = nodeFields.length;
                const nodeTypes = meta.node_types[0];
                const nodeNameOffset = nodeFields.indexOf('name');
                const nodeTypeOffset = nodeFields.indexOf('type');
                const nodeEdgeCountOffset = nodeFields.indexOf('edge_count');
                const edgeFields = meta.edge_fields;
                const edgeFieldCount = edgeFields.length;
                const edgeTypes = meta.edge_types[0];
                const edgeTypeOffset = edgeFields.indexOf('type');
                const edgeNameOrIndexOffset = edgeFields.indexOf('name_or_index');
                const edgeToNodeOffset = edgeFields.indexOf('to_node'); 

                if ([nodeNameOffset, nodeTypeOffset, nodeEdgeCountOffset, edgeTypeOffset, edgeNameOrIndexOffset, edgeToNodeOffset].includes(-1)) {
                     console.error('Could not find required fields in snapshot meta.');
                     return counts;
                }

                console.log(`Iterating through ${nodes.length / nodeFieldCount} nodes and ${edges.length / edgeFieldCount} edges...`);

                // --- Node & Edge Iteration --- 
                let edgeCursor = 0; 
                for (let i = 0; i < nodes.length; i += nodeFieldCount) {
                    const nodeTypeIndex = nodes[i + nodeTypeOffset];
                    const nodeNameIndex = nodes[i + nodeNameOffset];
                    const edgeCount = nodes[i + nodeEdgeCountOffset]; 

                    if (nodeTypeIndex < 0 || nodeTypeIndex >= nodeTypes.length) continue; 
                    const nodeTypeName = nodeTypes[nodeTypeIndex];

                    if (nodeNameIndex < 0 || nodeNameIndex >= strings.length) continue; 
                    const ownerNodeName = strings[nodeNameIndex]; 

                    // --- Count Node by Name (Basic Types) ---
                    if (nodeTypeName === 'object') {
                        let matchedBaseType = null;
                        let countKey = null;
                        if (exactTargetTypeSet.has(ownerNodeName)) {
                            matchedBaseType = ownerNodeName;
                            countKey = typeToCountKey[matchedBaseType];
                        } else {
                            for (const baseType in broadTypeToCountKey) {
                                if (ownerNodeName.includes(baseType)) {
                                    const exclusions = broadExclusions[baseType] || [];
                                    if (!exclusions.some(ex => ownerNodeName.includes(ex))) {
                                         matchedBaseType = baseType;
                                         countKey = broadTypeToCountKey[matchedBaseType];
                                         break; 
                                    }
                                }
                            }
                        }
                        if (countKey) {
                            counts[countKey]++;
                        }

                        // --- Constructor Analysis (Using Owner Node Name) ---
                        const instanceName = ownerNodeName; // Use the instance node's name

                        // Apply Filters to the instance name
                        let isRelevantInstance = true;
                        if (jsBuiltIns.has(instanceName) ||
                            instanceName.startsWith('(') || instanceName.startsWith('system /') || instanceName.startsWith('v8') ||
                            webglInternalsExclude.has(instanceName) ||
                            browserApiExcludes.has(instanceName) ||
                            domExcludes.has(instanceName) ||
                            threeHelpersExclude.has(instanceName) ||
                            threeLoadersExclude.has(instanceName) ||
                            threeMathExclude.has(instanceName) ||
                            threeCurvesExclude.has(instanceName) ||
                            typedArrayAndAttributesExclude.has(instanceName) ||
                            otherLibsExclude.has(instanceName) ||
                            (instanceName.length <= 2 && instanceName !== '_') ||
                            manualMiscExcludes.has(instanceName) ||
                            // Add extra check: Often internal/system objects might have spaces or slashes
                            instanceName.includes(' ') || instanceName.includes('/') ||
                            // Exclude the basic node count types we already track separately
                            (matchedBaseType !== null) )
                        {
                            isRelevantInstance = false;
                        }

                        // Categorize and Increment Count based on instance name
                        if (isRelevantInstance) {
                             if (knownThreejsTypes.has(instanceName)) {
                                threejsConstructorCounts[instanceName] = (threejsConstructorCounts[instanceName] || 0) + 1;
                            } else {
                                // Assumed game-specific if relevant and not Three.js or basic type
                                gameConstructorCounts[instanceName] = (gameConstructorCounts[instanceName] || 0) + 1;
                            }
                            // miscConstructorCounts remains unused for now
                        }
                    } // End if (nodeTypeName === 'object')

                    // --- Original Edge Processing Logic (COMMENTED OUT FOR NOW - Might be needed for other analysis later) ---
                    /*
                    const currentEdgeEnd = edgeCursor + edgeCount * edgeFieldCount;
                    while(edgeCursor < currentEdgeEnd && edgeCursor < edges.length) {
                        const edgeTypeIndex = edges[edgeCursor + edgeTypeOffset];
                        const edgeNameOrIndex = edges[edgeCursor + edgeNameOrIndexOffset];
                        const toNodeOffsetInNodesArray = edges[edgeCursor + edgeToNodeOffset];

                        if (edgeTypeIndex >= 0 && edgeTypeIndex < edgeTypes.length) {
                            const edgeTypeName = edgeTypes[edgeTypeIndex];

                            // Example: Find 'constructor' property (original logic, now handled above)
                            // if (edgeTypeName === 'property') {
                            //     let propName = "(invalid_name_index)";
                            //     if (edgeNameOrIndex >= 0 && edgeNameOrIndex < strings.length) {
                            //         propName = strings[edgeNameOrIndex];
                            //     }
                            //     if (propName === 'constructor') {
                            //         // ... logic to find target node name ...
                            //     }
                            // }
                        }
                        edgeCursor += edgeFieldCount;
                    }
                    edgeCursor = currentEdgeEnd; // Ensure cursor is correct after loop
                    */
                   // Advance edge cursor manually since the loop is commented out
                   edgeCursor += edgeCount * edgeFieldCount;

                } // End node loop

                // --- Log Constructor Analysis (Categorized) --- 
                const logCategory = (title, categoryCounts) => {
                    const keys = Object.keys(categoryCounts).sort();
                    if (keys.length > 0) {
                        console.log(`\n--- ${title} ---`);
                        keys.forEach(constructorName => {
                            if (categoryCounts[constructorName] > 0) {
                                console.log(`${constructorName}: ${categoryCounts[constructorName]}`);
                            }
                        });
                    } 
                };

                logCategory("Three.js Constructors", threejsConstructorCounts);
                logCategory("Game Specific Constructors", gameConstructorCounts);
                // logCategory("Misc/Unknown Constructors", miscConstructorCounts); // Log if/when used
                console.log(`--- End Constructor Analysis ---`);

            } catch (e) {
                console.error('Error during snapshot analysis:', e.message, e.stack);
                Object.keys(counts).forEach(key => { counts[key] = 0; }); 
                // Reset categorized counts too
                threejsConstructorCounts = {}; 
                gameConstructorCounts = {};
                miscConstructorCounts = {};
            }

            console.log(`Analysis Complete (Node Counts) - Geo: ${counts.geometryCount}, Mat: ${counts.materialCount}, Tex: ${counts.textureCount}, RT: ${counts.renderTargetCount}, Mesh: ${counts.meshCount}, Grp: ${counts.groupCount}`);
            return { nodeCounts: counts, constructorCounts: { threejs: threejsConstructorCounts, game: gameConstructorCounts, misc: miscConstructorCounts } };
        }

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
        const initialSnapshotData = await takeSnapshot(cdpSession);
        let initialAnalysisResult = analyzeSnapshot(initialSnapshotData);
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
                snapshotDataString = await takeSnapshot(cdpSession);
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
                currentAnalysisResult = analyzeSnapshot(snapshotDataString);

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
        if (server) server.close(); // Close server on error
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
    // if (intervalId) clearInterval(intervalId); // Needs intervalId
    // if (server) server.close(() => console.log('Server closed.')); // Needs server
    // if (browser) await browser.close(); // Needs browser
    console.warn("Cleanup on SIGINT is basic. Ensure resources are closed if errors occur before full setup.");
    process.exit(0);
});

