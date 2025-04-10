import * as THREE from 'three';

// Define the structure for initialization options
interface VibeWatchdogOptions {
  scene: THREE.Scene;
  token: string;
  backendUrl?: string; // Optional: Defaults will be handled internally
  interval?: number; // Optional: Interval in ms for scene traversal
}

// Define the structure for the counts payload
interface SceneCounts {
  [constructorName: string]: number;
}

const DEFAULT_INTERVAL = 10000; // Default traversal interval: 10 seconds
const DEFAULT_BACKEND_URL = 'wss://your-vibe-watchdog-backend.com/ws/agent'; // Placeholder

class VibeWatchdogClient {
  private scene: THREE.Scene | null = null;
  private token: string | null = null;
  private backendUrl: string = DEFAULT_BACKEND_URL;
  private interval: number = DEFAULT_INTERVAL;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private ws: WebSocket | null = null;
  private isConnected: boolean = false;
  private objectTypesToTrack: Set<string> = new Set([
    'Mesh', 'BufferGeometry', 'Material', 'Texture', 'Light' // Basic types
    // TODO: Add more THREE types, make configurable?
  ]);

  /**
   * Initializes the Vibe Watchdog client library.
   * @param options Configuration options including the THREE.Scene and API token.
   */
  public init(options: VibeWatchdogOptions): void {
    console.log('[VibeWatchdog] Initializing...');

    if (this.intervalId) {
      console.warn('[VibeWatchdog] Already initialized. Clearing previous interval.');
      clearInterval(this.intervalId);
      this.disconnectWebSocket();
    }

    // Validate using duck typing (more robust with module linking)
    if (!options?.scene || typeof options.scene !== 'object' || options.scene.isScene !== true) {
      console.error('[VibeWatchdog] Initialization failed: A valid THREE.Scene object (with .isScene === true) must be provided in options.scene.');
      return;
    }
    if (!options?.token || typeof options.token !== 'string' || options.token.trim() === '') {
      console.error('[VibeWatchdog] Initialization failed: Valid API token must be provided in options.token.');
      return;
    }

    this.scene = options.scene;
    this.token = options.token; // Store the token
    this.backendUrl = options.backendUrl || DEFAULT_BACKEND_URL;
    this.interval = options.interval || DEFAULT_INTERVAL;

    console.log(`[VibeWatchdog] Configured with Interval: ${this.interval}ms, Backend: ${this.backendUrl}`);

    // Start the monitoring loop
    this.startMonitoringLoop();

    // Attempt to connect to the backend
    this.connectWebSocket();

    console.log('[VibeWatchdog] Initialization complete.');
  }

  /**
   * Starts the periodic scene traversal.
   */
  private startMonitoringLoop(): void {
    if (this.intervalId) {
        clearInterval(this.intervalId);
    }
    console.log(`[VibeWatchdog] Starting monitoring loop (Interval: ${this.interval}ms)`);
    // Run immediately first, then set interval
    this.performSceneTraversal();
    this.intervalId = setInterval(() => {
      this.performSceneTraversal();
    }, this.interval);
  }

  /**
   * Performs a single traversal of the scene and logs/sends the counts.
   */
  private performSceneTraversal(): void {
    if (!this.scene) {
      console.warn('[VibeWatchdog] Cannot traverse scene: Not initialized correctly.');
      return;
    }

    console.log('[VibeWatchdog] Performing scene traversal...');
    const counts: SceneCounts = {};
    this.objectTypesToTrack.forEach(type => counts[type] = 0); // Initialize tracked types to 0

    try {
      // Explicitly type 'obj' as THREE.Object3D
      this.scene.traverse((obj: THREE.Object3D) => {
        const constructorName = obj.constructor.name;
        // Basic type checking using constructor name (simple approach)
        // Could also use obj.isMesh, obj.isBufferGeometry etc. for robustness
        if(this.objectTypesToTrack.has(constructorName)) {
             counts[constructorName] = (counts[constructorName] || 0) + 1;
        }
        // TODO: Add logic for specific geometry/material/texture types if needed
        // TODO: Add logic for user-defined classes
      });

      console.log('[VibeWatchdog] Scene Counts:', counts);

      // Send data if connected
      this.sendData({ type: 'sceneCounts', payload: counts });

    } catch (error) {
       console.error('[VibeWatchdog] Error during scene traversal:', error);
    }
  }

  /**
   * Establishes WebSocket connection to the backend.
   */
  private connectWebSocket(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[VibeWatchdog] WebSocket already connected.');
      return;
    }

    console.log(`[VibeWatchdog] Attempting to connect WebSocket to ${this.backendUrl}...`);
    try {
      // Include token in connection - Query parameter is one way, headers are better but not standard in browser WebSocket API
      // Using a query parameter for simplicity here, backend needs to support this.
      // Consider sending token in first message after connection for better security.
      const urlWithToken = `${this.backendUrl}?token=${encodeURIComponent(this.token || '')}`;
      this.ws = new WebSocket(urlWithToken);

      this.ws.onopen = () => {
        console.log('[VibeWatchdog] WebSocket connection established.');
        this.isConnected = true;
        // Optional: Send a confirmation message or initial data
        // this.sendData({ type: 'hello', agent: '@vibewatchdog/client' });
      };

      this.ws.onmessage = (event) => {
        console.log('[VibeWatchdog] Received message from backend:', event.data);
        // TODO: Handle commands from backend (e.g., force snapshot)
        this.handleBackendCommand(event.data);
      };

      this.ws.onerror = (event) => {
        console.error('[VibeWatchdog] WebSocket error:', event);
        this.isConnected = false;
        // TODO: Implement reconnection logic?
      };

      this.ws.onclose = (event) => {
        console.log(`[VibeWatchdog] WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
        this.isConnected = false;
        this.ws = null;
        // TODO: Implement reconnection logic?
      };

    } catch (error) {
      console.error('[VibeWatchdog] Failed to create WebSocket:', error);
      this.isConnected = false;
    }
  }

  /**
   * Sends data payload to the backend via WebSocket.
   * @param data The data object to send.
   */
  private sendData(data: object): void {
    if (!this.isConnected || !this.ws) {
      console.log('[VibeWatchdog] Cannot send data: WebSocket not connected. Data:', data);
      return;
    }
    try {
        const message = JSON.stringify(data);
        console.log(`[VibeWatchdog] Sending data: ${message.substring(0, 150)}${message.length > 150 ? '...' : ''}`);
        this.ws.send(message);
    } catch (error) {
        console.error('[VibeWatchdog] Error sending data via WebSocket:', error);
    }
  }

  /**
   * Handles commands received from the backend.
   * @param messageData Raw message data from WebSocket.
   */
   private handleBackendCommand(messageData: any): void {
     try {
        const command = JSON.parse(messageData);
        console.log('[VibeWatchdog] Parsed command:', command);
        // switch (command.type) {
        //    case 'force_snapshot':
        //       console.log('[VibeWatchdog] Received force_snapshot command (TODO: implement)');
        //       // this.performHeapSnapshot();
        //       break;
        //    default:
        //       console.warn(`[VibeWatchdog] Unknown command type: ${command.type}`);
        // }
     } catch (error) {
        console.warn('[VibeWatchdog] Failed to parse backend message:', messageData, error);
     }
   }

  /**
   * Closes the WebSocket connection.
   */
  private disconnectWebSocket(): void {
    if (this.ws) {
      console.log('[VibeWatchdog] Closing WebSocket connection...');
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Stops the monitoring interval and disconnects WebSocket.
   * Call this when the application is shutting down or monitoring is no longer needed.
   */
  public dispose(): void {
    console.log('[VibeWatchdog] Disposing client...');
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[VibeWatchdog] Monitoring interval stopped.');
    }
    this.disconnectWebSocket();
    this.scene = null;
    this.token = null;
     console.log('[VibeWatchdog] Client disposed.');
  }
}

// Export a singleton instance
export const vibeWatchdog = new VibeWatchdogClient(); 