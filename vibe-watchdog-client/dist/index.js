"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  vibeWatchdog: () => vibeWatchdog
});
module.exports = __toCommonJS(index_exports);
var knownThreejsTypes = /* @__PURE__ */ new Set([
  "Scene",
  "Object3D",
  "Mesh",
  "Group",
  "SkinnedMesh",
  "InstancedMesh",
  "BatchedMesh",
  "LOD",
  "Points",
  "Line",
  "LineLoop",
  "LineSegments",
  "Sprite",
  "BufferGeometry",
  "InstancedBufferGeometry",
  "BoxGeometry",
  "CapsuleGeometry",
  "CircleGeometry",
  "ConeGeometry",
  "CylinderGeometry",
  "DodecahedronGeometry",
  "EdgesGeometry",
  "ExtrudeGeometry",
  "IcosahedronGeometry",
  "LatheGeometry",
  "OctahedronGeometry",
  "PlaneGeometry",
  "PolyhedronGeometry",
  "RingGeometry",
  "ShapeGeometry",
  "SphereGeometry",
  "TetrahedronGeometry",
  "TorusGeometry",
  "TorusKnotGeometry",
  "TubeGeometry",
  "WireframeGeometry",
  "Shape",
  "Path",
  "Material",
  "LineBasicMaterial",
  "LineDashedMaterial",
  "MeshBasicMaterial",
  "MeshDepthMaterial",
  "MeshDistanceMaterial",
  "MeshLambertMaterial",
  "MeshMatcapMaterial",
  "MeshNormalMaterial",
  "MeshPhongMaterial",
  "MeshPhysicalMaterial",
  "MeshStandardMaterial",
  "MeshToonMaterial",
  "PointsMaterial",
  "RawShaderMaterial",
  "ShaderMaterial",
  "ShadowMaterial",
  "SpriteMaterial",
  "Texture",
  "CanvasTexture",
  "CompressedArrayTexture",
  "CompressedCubeTexture",
  "CompressedTexture",
  "CubeTexture",
  "Data3DTexture",
  "DataArrayTexture",
  "DataTexture",
  "DepthTexture",
  "FramebufferTexture",
  "VideoTexture",
  "WebGLRenderTarget",
  "WebGLCubeRenderTarget",
  "WebGLArrayRenderTarget",
  "Light",
  "AmbientLight",
  "DirectionalLight",
  "HemisphereLight",
  "LightProbe",
  "PointLight",
  "RectAreaLight",
  "SpotLight",
  "LightShadow",
  "DirectionalLightShadow",
  "PointLightShadow",
  "SpotLightShadow",
  "Camera",
  "ArrayCamera",
  "OrthographicCamera",
  "PerspectiveCamera",
  "StereoCamera",
  "CubeCamera",
  "Audio",
  "AudioListener",
  "PositionalAudio",
  "AnimationClip",
  "AnimationMixer",
  "AnimationAction",
  "AnimationObjectGroup",
  "KeyframeTrack",
  "BooleanKeyframeTrack",
  "ColorKeyframeTrack",
  "NumberKeyframeTrack",
  "QuaternionKeyframeTrack",
  "StringKeyframeTrack",
  "VectorKeyframeTrack",
  "Raycaster",
  "Layers",
  "Clock",
  "EventDispatcher"
  // Excluding Helpers, Loaders, Math, Curves, Attributes, WebGL internals etc. as they are less likely
  // to be directly traversed in a typical scene graph or indicative of app-level leaks.
]);
var DEFAULT_INTERVAL = 1e4;
var DEFAULT_BACKEND_URL = "wss://your-vibe-watchdog-backend.com/ws/agent";
var VibeWatchdogClient = class {
  constructor() {
    this.scene = null;
    this.token = null;
    this.backendUrl = DEFAULT_BACKEND_URL;
    this.interval = DEFAULT_INTERVAL;
    this.intervalId = null;
    this.ws = null;
    this.isConnected = false;
    this.excludedTypes = /* @__PURE__ */ new Set();
  }
  /**
   * Initializes the Vibe Watchdog client library.
   * @param options Configuration options including the THREE.Scene and API token.
   */
  init(options) {
    console.log("[VibeWatchdog] Initializing...");
    if (this.intervalId) {
      console.warn("[VibeWatchdog] Already initialized. Clearing previous state.");
      this.dispose();
    }
    if (!(options == null ? void 0 : options.scene) || typeof options.scene !== "object" || options.scene.isScene !== true) {
      console.error("[VibeWatchdog] Initialization failed: A valid THREE.Scene object (with .isScene === true) must be provided in options.scene.");
      return;
    }
    if (!(options == null ? void 0 : options.token) || typeof options.token !== "string" || options.token.trim() === "") {
      console.error("[VibeWatchdog] Initialization failed: Valid API token must be provided in options.token.");
      return;
    }
    this.scene = options.scene;
    this.token = options.token;
    this.backendUrl = options.backendUrl || DEFAULT_BACKEND_URL;
    this.interval = options.interval || DEFAULT_INTERVAL;
    this.excludedTypes = new Set(options.excludeTypes || []);
    console.log(`[VibeWatchdog] Configured with Interval: ${this.interval}ms, Backend: ${this.backendUrl}`);
    if (this.excludedTypes.size > 0) {
      console.log(`[VibeWatchdog] Excluding types: ${[...this.excludedTypes].join(", ")}`);
    }
    this.startMonitoringLoop();
    this.connectWebSocket();
    console.log("[VibeWatchdog] Initialization complete.");
  }
  /**
   * Starts the periodic scene traversal.
   */
  startMonitoringLoop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    console.log(`[VibeWatchdog] Starting monitoring loop (Interval: ${this.interval}ms)`);
    this.performSceneTraversal();
    this.intervalId = setInterval(() => {
      this.performSceneTraversal();
    }, this.interval);
  }
  /**
   * Performs a single traversal of the scene and logs/sends the counts.
   */
  performSceneTraversal() {
    if (!this.scene) {
      console.warn("[VibeWatchdog] Cannot traverse scene: Not initialized correctly.");
      return;
    }
    const uniqueGeometries = /* @__PURE__ */ new Set();
    const uniqueMaterials = /* @__PURE__ */ new Set();
    const uniqueTextures = /* @__PURE__ */ new Set();
    const counts = {
      categories: {
        Mesh: 0,
        Light: 0,
        Camera: 0,
        Scene: 0,
        Group: 0,
        Sprite: 0,
        Object3D: 0,
        Geometry: 0,
        Material: 0,
        Texture: 0,
        Other: 0
      },
      threejsConstructors: {},
      userConstructors: {}
    };
    try {
      this.scene.traverse((obj) => {
        console.log(`[VibeWatchdog DEBUG] Traversing: ${obj.constructor.name}`, obj);
        const constructorName = obj.constructor.name;
        let effectiveType = constructorName;
        if ((constructorName === "Group" || constructorName === "Object3D") && obj.name && obj.name !== "") {
          if (obj.name !== constructorName) {
            effectiveType = obj.name;
          }
        }
        let isCategorized = false;
        if (this.excludedTypes.has(effectiveType)) {
          return;
        }
        if (knownThreejsTypes.has(effectiveType)) {
          counts.threejsConstructors[effectiveType] = (counts.threejsConstructors[effectiveType] || 0) + 1;
        } else {
          counts.userConstructors[effectiveType] = (counts.userConstructors[effectiveType] || 0) + 1;
        }
        if ("isMesh" in obj && obj.isMesh) {
          counts.categories.Mesh++;
          isCategorized = true;
          const mesh = obj;
          if (mesh.geometry) uniqueGeometries.add(mesh.geometry);
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((mat) => {
              if (mat) uniqueMaterials.add(mat);
            });
          } else if (mesh.material) {
            uniqueMaterials.add(mesh.material);
          }
        } else if ("isLight" in obj && obj.isLight) {
          counts.categories.Light++;
          isCategorized = true;
        } else if ("isCamera" in obj && obj.isCamera) {
          counts.categories.Camera++;
          isCategorized = true;
        } else if ("isScene" in obj && obj.isScene) {
          counts.categories.Scene++;
          isCategorized = true;
        } else if ("isGroup" in obj && obj.isGroup) {
          counts.categories.Group++;
          isCategorized = true;
        } else if ("isSprite" in obj && obj.isSprite) {
          counts.categories.Sprite++;
          isCategorized = true;
        }
        if (!isCategorized && ("isObject3D" in obj && obj.isObject3D)) {
          counts.categories.Object3D++;
          isCategorized = true;
        }
        if (!isCategorized) {
          counts.categories.Other++;
        }
      });
      counts.categories.Geometry = uniqueGeometries.size;
      counts.categories.Material = uniqueMaterials.size;
      uniqueMaterials.forEach((material) => {
        const matAny = material;
        for (const prop of ["map", "envMap", "aoMap", "alphaMap", "bumpMap", "displacementMap", "emissiveMap", "lightMap", "metalnessMap", "normalMap", "roughnessMap", "specularMap", "gradientMap"]) {
          const tex = matAny[prop];
          if (tex && tex.isTexture) {
            uniqueTextures.add(tex);
          }
        }
      });
      counts.categories.Texture = uniqueTextures.size;
      const logCounts = (label, countObj) => {
        const sortedEntries = Object.entries(countObj).sort(([a], [b]) => a.localeCompare(b));
        if (sortedEntries.length > 0) {
          console.log(`[VibeWatchdog] ${label}:`, Object.fromEntries(sortedEntries));
        }
      };
      console.log("[VibeWatchdog] --- Traversal Complete ---");
      logCounts("Scene Categories", counts.categories);
      logCounts("THREE.js Constructors", counts.threejsConstructors);
      logCounts("User Constructors", counts.userConstructors);
      console.log("[VibeWatchdog] --------------------------");
      this.sendData({ type: "sceneCounts", payload: counts });
    } catch (error) {
      console.error("[VibeWatchdog] Error during scene traversal:", error);
    }
  }
  /**
   * Establishes WebSocket connection to the backend.
   */
  connectWebSocket() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log("[VibeWatchdog] WebSocket already connected.");
      return;
    }
    console.log(`[VibeWatchdog] Attempting to connect WebSocket to ${this.backendUrl}...`);
    try {
      const urlWithToken = `${this.backendUrl}?token=${encodeURIComponent(this.token || "")}`;
      this.ws = new WebSocket(urlWithToken);
      this.ws.onopen = () => {
        console.log("[VibeWatchdog] WebSocket connection established.");
        this.isConnected = true;
      };
      this.ws.onmessage = (event) => {
        console.log("[VibeWatchdog] Received message from backend:", event.data);
        this.handleBackendCommand(event.data);
      };
      this.ws.onerror = (event) => {
        console.error("[VibeWatchdog] WebSocket error:", event);
        this.isConnected = false;
      };
      this.ws.onclose = (event) => {
        console.log(`[VibeWatchdog] WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
        this.isConnected = false;
        this.ws = null;
      };
    } catch (error) {
      console.error("[VibeWatchdog] Failed to create WebSocket:", error);
      this.isConnected = false;
    }
  }
  /**
   * Sends data payload to the backend via WebSocket.
   * @param data The data object to send.
   */
  sendData(data) {
    if (!this.isConnected || !this.ws) {
      console.log("[VibeWatchdog] Would send data (WebSocket not connected): ", data);
      return;
    }
    try {
      const message = JSON.stringify(data);
      console.log(`[VibeWatchdog] Sending data: ${message.substring(0, 150)}${message.length > 150 ? "..." : ""}`);
      this.ws.send(message);
    } catch (error) {
      console.error("[VibeWatchdog] Error sending data via WebSocket:", error);
    }
  }
  /**
   * Handles commands received from the backend.
   * @param messageData Raw message data from WebSocket.
   */
  handleBackendCommand(messageData) {
    try {
      const command = JSON.parse(messageData);
      console.log("[VibeWatchdog] Parsed command:", command);
    } catch (error) {
      console.warn("[VibeWatchdog] Failed to parse backend message:", messageData, error);
    }
  }
  /**
   * Closes the WebSocket connection.
   */
  disconnectWebSocket() {
    if (this.ws) {
      console.log("[VibeWatchdog] Closing WebSocket connection...");
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
  /**
   * Stops the monitoring interval and disconnects WebSocket.
   * Call this when the application is shutting down or monitoring is no longer needed.
   */
  dispose() {
    console.log("[VibeWatchdog] Disposing client...");
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[VibeWatchdog] Monitoring interval stopped.");
    }
    this.disconnectWebSocket();
    this.scene = null;
    this.token = null;
    this.excludedTypes.clear();
    console.log("[VibeWatchdog] Client disposed.");
  }
};
var vibeWatchdog = new VibeWatchdogClient();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  vibeWatchdog
});
