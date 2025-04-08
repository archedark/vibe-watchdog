const puppeteer = require('puppeteer');
const minimist = require('minimist');
const fs = require('fs').promises; // Added for file system operations
const path = require('path'); // Added for path manipulation

const args = minimist(process.argv.slice(2));

// --- Add Help Function ---
function showHelp() {
    console.log(`
Usage: node watchdog.js --url <your-game-url> [options]

Options:
  --url <url>          REQUIRED: The URL of the web page/game to monitor.
  --headless           Run Puppeteer in headless mode (no visible browser window). Default: false.
  --interval <ms>      The interval (in milliseconds) between heap snapshots. Default: 30000 (30 seconds).
  --threshold <count>  The number of consecutive increases in a resource count to trigger a potential leak warning. Default: 3.
  --max-reports <num>  The maximum number of JSON reports to keep in the reports directory. Default: 10.
  --help               Show this help message and exit.
    `);
    process.exit(0);
}

if (args.help) {
    showHelp();
}
// --- End Help Function ---

const targetUrl = args.url;
const isHeadless = args.headless || false; // Default to false (visible browser)
const interval = args.interval || 30000; // Default to 30 seconds
const threshold = args.threshold || 3; // Default to 3 consecutive increases
const maxReports = args['max-reports'] || 10; // Default to 10 reports

if (!targetUrl) {
    console.error('Error: --url parameter is required.');
    console.log('Usage: node watchdog.js --url <your-game-url> [--headless] [--interval <ms>] [--threshold <count>] [--max-reports <num>]');
    process.exit(1);
}

async function runWatchdog() {
    console.log(`Starting Watchdog for URL: ${targetUrl}`);
    console.log(`Headless mode: ${isHeadless}`);
    console.log(`Snapshot interval: ${interval}ms`);
    console.log(`Leak threshold: ${threshold} increases`);
    console.log(`Maximum reports to keep: ${maxReports}`); // Log the max reports value
    console.warn('Watchdog started. Using simplified analysis for MVP - results may be inaccurate.');

    const reportsDir = path.join(__dirname, 'reports'); // Define reports directory

    let browser;
    try {
        await fs.mkdir(reportsDir, { recursive: true }); // Create reports directory if it doesn't exist
        console.log(`Reports will be saved to: ${reportsDir}`);

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

                    // --- Count Node by Name (No more node structure logging needed here) ---
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
                    }

                    // --- Process Outgoing Edges for Constructor Analysis --- 
                    const currentEdgeEnd = edgeCursor + edgeCount * edgeFieldCount;
                    while(edgeCursor < currentEdgeEnd && edgeCursor < edges.length) {
                        const edgeTypeIndex = edges[edgeCursor + edgeTypeOffset];
                        const edgeNameOrIndex = edges[edgeCursor + edgeNameOrIndexOffset]; 
                        const toNodeOffsetInNodesArray = edges[edgeCursor + edgeToNodeOffset]; 

                        if (edgeTypeIndex >= 0 && edgeTypeIndex < edgeTypes.length) {
                            const edgeTypeName = edgeTypes[edgeTypeIndex];

                            if (edgeTypeName === 'property') {
                                 let propName = "(invalid_name_index)";
                                 if (edgeNameOrIndex >= 0 && edgeNameOrIndex < strings.length) {
                                    propName = strings[edgeNameOrIndex];
                                 }

                                 if (propName === 'constructor') {
                                    const targetNodeNameFieldIndex = toNodeOffsetInNodesArray + nodeNameOffset;
                                    if (targetNodeNameFieldIndex >= 0 && targetNodeNameFieldIndex < nodes.length) {
                                        const targetNodeNameIndex = nodes[targetNodeNameFieldIndex];
                                        if (targetNodeNameIndex >= 0 && targetNodeNameIndex < strings.length) {
                                            const targetConstructorName = strings[targetNodeNameIndex];

                                            // --- Apply Filters --- 
                                            let isRelevantConstructor = true; 

                                            if (jsBuiltIns.has(targetConstructorName) ||
                                                targetConstructorName.startsWith('(') || targetConstructorName.startsWith('system /') || targetConstructorName.startsWith('v8') ||
                                                webglInternalsExclude.has(targetConstructorName) ||
                                                browserApiExcludes.has(targetConstructorName) ||
                                                domExcludes.has(targetConstructorName) ||
                                                threeHelpersExclude.has(targetConstructorName) ||
                                                threeLoadersExclude.has(targetConstructorName) ||
                                                threeMathExclude.has(targetConstructorName) ||
                                                threeCurvesExclude.has(targetConstructorName) ||
                                                typedArrayAndAttributesExclude.has(targetConstructorName) ||
                                                otherLibsExclude.has(targetConstructorName) ||
                                                (targetConstructorName.length <= 2 && targetConstructorName !== '_') || 
                                                // *** ADD CHECK FOR MANUAL EXCLUDES ***
                                                manualMiscExcludes.has(targetConstructorName) )
                                            {
                                                isRelevantConstructor = false;
                                            } 
                                            // Optional: Add heuristic for names suggesting internals even if not explicitly excluded?
                                            // else if (targetConstructorName.endsWith('Loader') || targetConstructorName.endsWith('Helper') || targetConstructorName.endsWith('Manager') || targetConstructorName.endsWith('Extension')) {
                                            //     // Consider if we want to exclude these generic patterns too
                                            // }

                                            // --- Categorize and Increment Count --- 
                                            if (isRelevantConstructor) {
                                                if (knownThreejsTypes.has(targetConstructorName)) {
                                                    threejsConstructorCounts[targetConstructorName] = (threejsConstructorCounts[targetConstructorName] || 0) + 1;
                                                } else {
                                                    // Assumed game-specific if relevant and not Three.js
                                                    gameConstructorCounts[targetConstructorName] = (gameConstructorCounts[targetConstructorName] || 0) + 1;
                                                }
                                                // miscConstructorCounts remains unused for now
                                            }
                                        }
                                    }
                                 }
                            }
                        }
                        edgeCursor += edgeFieldCount; 
                    }
                     edgeCursor = currentEdgeEnd; // Ensure cursor is correct after loop
                }

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

        // --- ADD manageReports function ---
        async function manageReports(dir, maxReportsToKeep) {
            try {
                const files = await fs.readdir(dir);
                const reportFiles = files
                    .filter(f => f.startsWith('report-') && f.endsWith('.json'))
                    .map(f => ({
                        name: f,
                        // Extract timestamp reliably (assuming ISO format YYYY-MM-DDTHH-MM-SS.mmmZ)
                        time: new Date(f.substring(7, f.length - 5).replace(/-/g, ':').replace('T', ' ').replace('Z', '')).getTime() 
                    }))
                    .sort((a, b) => a.time - b.time); // Sort oldest first

                if (reportFiles.length > maxReportsToKeep) {
                    const filesToDelete = reportFiles.slice(0, reportFiles.length - maxReportsToKeep);
                    console.log(`Rotating reports: Keeping ${maxReportsToKeep}, removing ${filesToDelete.length} oldest reports.`);
                    for (const file of filesToDelete) {
                        try {
                            await fs.unlink(path.join(dir, file.name));
                            // console.log(`Deleted old report: ${file.name}`);
                        } catch (delErr) {
                            console.warn(`Failed to delete old report ${file.name}:`, delErr.message);
                        }
                    }
                }
            } catch (err) {
                console.error('Error managing reports:', err.message);
            }
        }

        // --- ADD calculateConstructorDelta function ---
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

        // --- ADD saveReport function ---
        async function saveReport(dir, reportData) {
            const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '') + 'Z'; // Format: YYYY-MM-DDTHH-MM-SSZ
            const filename = `report-${timestamp}.json`;
            const filepath = path.join(dir, filename);

            try {
                await fs.writeFile(filepath, JSON.stringify(reportData, null, 2));
                console.log(`Report saved: ${filename}`);
                await manageReports(dir, maxReports); // Pass the configured maxReports value
            } catch (err) {
                console.error(`Error saving report ${filename}:`, err.message);
            }
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
        await saveReport(reportsDir, initialReportData); // Save initial report with delta
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
        console.log(`\nSetting snapshot interval to ${interval}ms`);
        const intervalId = setInterval(async () => {
            console.log('\n--- Interval Start ---');
            // Step 6: Retrieve snapshot data
            const snapshotDataString = await takeSnapshot(cdpSession);

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

                await saveReport(reportsDir, reportData); // Save interval report with delta
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

            } else if (!currentAnalysisResult) {
                console.warn('Skipping comparison due to missing new snapshot data.');
            } else { // Only previousAnalysisResult exists (first interval after successful initial snapshot)
                const prevCounts = previousAnalysisResult.nodeCounts; // Use nodeCounts
                console.log(`[${new Date().toLocaleTimeString()}] Initial Counts - Geo: ${prevCounts.geometryCount}, Mat: ${prevCounts.materialCount}, Tex: ${prevCounts.textureCount}, RT: ${prevCounts.renderTargetCount}, Mesh: ${prevCounts.meshCount}, Grp: ${prevCounts.groupCount}`); // Added new types
            }
            // Update previousAnalysisResult for the next interval
            previousAnalysisResult = currentAnalysisResult || previousAnalysisResult; 
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

