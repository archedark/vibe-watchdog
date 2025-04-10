import * as THREE from 'three';

interface VibeWatchdogOptions {
    scene: THREE.Scene;
    token: string;
    backendUrl?: string;
    interval?: number;
    excludeTypes?: string[];
}
declare class VibeWatchdogClient {
    private scene;
    private token;
    private backendUrl;
    private interval;
    private intervalId;
    private ws;
    private isConnected;
    private excludedTypes;
    /**
     * Initializes the Vibe Watchdog client library.
     * @param options Configuration options including the THREE.Scene and API token.
     */
    init(options: VibeWatchdogOptions): void;
    /**
     * Starts the periodic scene traversal.
     */
    private startMonitoringLoop;
    /**
     * Performs a single traversal of the scene and logs/sends the counts.
     */
    private performSceneTraversal;
    /**
     * Establishes WebSocket connection to the backend.
     */
    private connectWebSocket;
    /**
     * Sends data payload to the backend via WebSocket.
     * @param data The data object to send.
     */
    private sendData;
    /**
     * Handles commands received from the backend.
     * @param messageData Raw message data from WebSocket.
     */
    private handleBackendCommand;
    /**
     * Closes the WebSocket connection.
     */
    private disconnectWebSocket;
    /**
     * Stops the monitoring interval and disconnects WebSocket.
     * Call this when the application is shutting down or monitoring is no longer needed.
     */
    dispose(): void;
}
declare const vibeWatchdog: VibeWatchdogClient;

export { vibeWatchdog };
