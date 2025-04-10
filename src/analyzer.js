// Contains the logic for parsing and analyzing V8 heap snapshots

// --- Require Constants ---
const {
    typeToCountKey,
    exactTargetTypeSet,
    broadTypeToCountKey,
    broadExclusions,
    reportPropertiesForTypes, // This might be unused now, review if needed
    knownThreejsTypes,
    jsBuiltIns,
    webglInternalsExclude,
    browserApiExcludes,
    domExcludes,
    threeHelpersExclude,
    threeLoadersExclude,
    threeMathExclude,
    threeCurvesExclude,
    typedArrayAndAttributesExclude,
    otherLibsExclude,
    manualMiscExcludes
} = require('./analyzer-constants.js');

// --- Target Type Definitions (REMOVED - Now in constants file) ---
// const typeToCountKey = { ... };
// ... all other const Set = new Set([...]) definitions removed ...


/**
 * Analyzes a V8 heap snapshot JSON string to count specific object types and constructors.
 * @param {string} snapshotJsonString - The heap snapshot data as a JSON string.
 * @returns {{nodeCounts: object, constructorCounts: object}|null} - An object containing node counts and categorized constructor counts, or null if analysis fails.
 */
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
        // Return a structure consistent with successful analysis but with zero counts
        return { nodeCounts: counts, constructorCounts: { threejs: {}, game: {}, misc: {} } };
    }

    try {
        const snapshot = JSON.parse(snapshotJsonString);

        // --- Validate Snapshot Structure --- 
        if (!snapshot?.nodes || !snapshot.edges || !snapshot.strings || 
            !snapshot.snapshot?.meta?.node_fields || !snapshot.snapshot.meta.edge_fields || 
            !snapshot.snapshot.meta.node_types?.[0] || !snapshot.snapshot.meta.edge_types?.[0] ||
            !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges) || !Array.isArray(snapshot.strings) ||
            !Array.isArray(snapshot.snapshot.meta.node_fields) || !Array.isArray(snapshot.snapshot.meta.edge_fields) ||
            !Array.isArray(snapshot.snapshot.meta.node_types[0]) || !Array.isArray(snapshot.snapshot.meta.edge_types[0])) {
            console.warn('Snapshot JSON parsed, but essential structure (nodes, edges, strings, meta) not found or invalid.');
            // Return consistent zero-count structure on validation failure
            return { nodeCounts: counts, constructorCounts: { threejs: {}, game: {}, misc: {} } };
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
        // const edgeTypes = meta.edge_types[0]; // Edge types currently unused in simplified analysis
        // const edgeTypeOffset = edgeFields.indexOf('type'); // Currently unused
        // const edgeNameOrIndexOffset = edgeFields.indexOf('name_or_index'); // Currently unused
        const edgeToNodeOffset = edgeFields.indexOf('to_node'); 

        // Check only required node fields offsets
        if ([nodeNameOffset, nodeTypeOffset, nodeEdgeCountOffset, edgeToNodeOffset].includes(-1)) {
             console.error('Could not find required fields in snapshot meta (node: name, type, edge_count; edge: to_node).');
             // Return consistent zero-count structure
             return { nodeCounts: counts, constructorCounts: { threejs: {}, game: {}, misc: {} } };
        }

        console.log(`Iterating through ${nodes.length / nodeFieldCount} nodes...`); // Removed edge count log as edges aren't iterated explicitly

        // --- Node & Edge Iteration (Simplified) --- 
        // We only iterate nodes now for counting and constructor analysis
        let edgeCursor = 0; // Keep track of edge cursor to skip edges correctly
        for (let i = 0; i < nodes.length; i += nodeFieldCount) {
            const nodeTypeIndex = nodes[i + nodeTypeOffset];
            const nodeNameIndex = nodes[i + nodeNameOffset];
            const edgeCount = nodes[i + nodeEdgeCountOffset]; 

            // Basic validation
            if (nodeTypeIndex < 0 || nodeTypeIndex >= nodeTypes.length) {
                edgeCursor += edgeCount * edgeFieldCount; // Skip edges for invalid node
                continue; 
            }
            const nodeTypeName = nodeTypes[nodeTypeIndex];

            if (nodeNameIndex < 0 || nodeNameIndex >= strings.length) {
                edgeCursor += edgeCount * edgeFieldCount; // Skip edges for invalid node
                continue; 
            }
            const ownerNodeName = strings[nodeNameIndex]; 

            // --- Count Node by Name (Basic Types) --- (Unchanged)
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

                // --- Constructor Analysis (Using Owner Node Name) --- (Unchanged)
                const instanceName = ownerNodeName; 

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
                    instanceName.includes(' ') || instanceName.includes('/') ||
                    (matchedBaseType !== null) ) // Exclude basic counted types
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

            // Advance edge cursor for the current node (even though edges aren't processed)
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
        // Reset counts to zero on error
        Object.keys(counts).forEach(key => { counts[key] = 0; }); 
        threejsConstructorCounts = {}; 
        gameConstructorCounts = {};
        miscConstructorCounts = {};
    }

    console.log(`Analysis Complete (Node Counts) - Geo: ${counts.geometryCount}, Mat: ${counts.materialCount}, Tex: ${counts.textureCount}, RT: ${counts.renderTargetCount}, Mesh: ${counts.meshCount}, Grp: ${counts.groupCount}`);
    return { nodeCounts: counts, constructorCounts: { threejs: threejsConstructorCounts, game: gameConstructorCounts, misc: miscConstructorCounts } };
}

module.exports = { analyzeSnapshot }; // Export the function
