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
    this.objectTypesToTrack = /* @__PURE__ */ new Set([
      "Mesh",
      "BufferGeometry",
      "Material",
      "Texture",
      "Light"
      // Basic types
      // TODO: Add more THREE types, make configurable?
    ]);
  }
  /**
   * Initializes the Vibe Watchdog client library.
   * @param options Configuration options including the THREE.Scene and API token.
   */
  init(options) {
    console.log("[VibeWatchdog] Initializing...");
    if (this.intervalId) {
      console.warn("[VibeWatchdog] Already initialized. Clearing previous interval.");
      clearInterval(this.intervalId);
      this.disconnectWebSocket();
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
    console.log(`[VibeWatchdog] Configured with Interval: ${this.interval}ms, Backend: ${this.backendUrl}`);
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
    console.log("[VibeWatchdog] Performing scene traversal...");
    const counts = {};
    this.objectTypesToTrack.forEach((type) => counts[type] = 0);
    try {
      this.scene.traverse((obj) => {
        const constructorName = obj.constructor.name;
        if (this.objectTypesToTrack.has(constructorName)) {
          counts[constructorName] = (counts[constructorName] || 0) + 1;
        }
      });
      console.log("[VibeWatchdog] Scene Counts:", counts);
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
      console.log("[VibeWatchdog] Cannot send data: WebSocket not connected. Data:", data);
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
    console.log("[VibeWatchdog] Client disposed.");
  }
};
var vibeWatchdog = new VibeWatchdogClient();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  vibeWatchdog
});
