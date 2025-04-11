// Contains constant sets used for heap snapshot analysis in analyzer.js
const fs = require('fs');
const path = require('path');

// --- Target Type Definitions (Still needed by analyzer.js) ---
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
const reportPropertiesForTypes = new Set(Object.keys(typeToCountKey)); 

// --- Filtering Sets for Constructor Analysis --- 
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

// --- Read Manual Exclusions from File ---
let manualMiscExcludes = new Set();
try {
    // Construct path relative to this file's directory, assuming manual-excludes.txt is in the parent (root) directory
    const excludesPath = path.join(__dirname, '../manual-excludes.txt'); 
    const excludesContent = fs.readFileSync(excludesPath, 'utf8');
    const excludesArray = excludesContent.split(',').map(item => item.trim()).filter(item => item.length > 0);
    manualMiscExcludes = new Set(excludesArray);
    // console.log(`Loaded ${manualMiscExcludes.size} manual exclusions from ${excludesPath}`);
} catch (err) {
    console.warn(`Warning: Could not read manual exclusions file (${err.message}). Proceeding without manual exclusions.`);
    // Proceed with an empty set if file reading fails
}

module.exports = {
    typeToCountKey,
    exactTargetTypeSet,
    broadTypeToCountKey,
    broadExclusions,
    reportPropertiesForTypes,
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
}; 