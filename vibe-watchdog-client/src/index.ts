import * as THREE from 'three';

// Define the structure for initialization options
interface VibeWatchdogOptions {
  scene: THREE.Scene;
  token: string;
  backendUrl?: string; // Optional: Defaults will be handled internally
  interval?: number; // Optional: Interval in ms for scene traversal
  excludeTypes?: string[]; // Optional: Array of constructor names to exclude from specific counts
}

// --- Types based on analyzer-constants.js (subset relevant to scene traversal) ---
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
    // Excluding Helpers, Loaders, Math, Curves, Attributes, WebGL internals etc. as they are less likely
    // to be directly traversed in a typical scene graph or indicative of app-level leaks.
]);

// Define the structure for the counts payload
interface SceneCounts {
  // Broad categories using obj.is[Type] checks + unique resources
  categories: {
    Mesh: number;
    Light: number;
    Camera: number;
    Scene: number;
    Group: number;
    Sprite: number;
    Object3D: number; // Non-specific Object3D nodes
    Geometry: number; // Unique geometries found on meshes
    Material: number; // Unique materials found on meshes
    Texture: number; // Unique textures found on materials
    Other: number; // Objects not matching known categories
  };
  // Specific constructor names found during traversal (excluding manually excluded types)
  threejsConstructors: {
    [constructorName: string]: number;
  };
  userConstructors: {
    [constructorName: string]: number;
  };
}

const DEFAULT_INTERVAL = 1000; // Default traversal interval: 1 second (was 10000)
const DEFAULT_BACKEND_URL = 'wss://your-vibe-watchdog-backend.com/ws/agent'; // Placeholder

class VibeWatchdogClient {
  private scene: THREE.Scene | null = null;
  private token: string | null = null;
  private backendUrl: string = DEFAULT_BACKEND_URL;
  private interval: number = DEFAULT_INTERVAL;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private ws: WebSocket | null = null;
  private isConnected: boolean = false;
  private excludedTypes: Set<string> = new Set();

  /**
   * Initializes the Vibe Watchdog client library.
   * @param options Configuration options including the THREE.Scene and API token.
   */
  public init(options: VibeWatchdogOptions): void {
    console.log('[VibeWatchdog] Initializing...');

    if (this.intervalId) {
      console.warn('[VibeWatchdog] Already initialized. Clearing previous state.');
      this.dispose(); // Clear interval and disconnect WebSocket
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
    this.excludedTypes = new Set(options.excludeTypes || []);

    console.log(`[VibeWatchdog] Configured with Interval: ${this.interval}ms, Backend: ${this.backendUrl}`);
    if (this.excludedTypes.size > 0) {
       console.log(`[VibeWatchdog] Excluding types: ${[...this.excludedTypes].join(', ')}`);
    }

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

    // console.log('[VibeWatchdog] Performing scene traversal...'); // Make less noisy
    const uniqueGeometries = new Set<THREE.BufferGeometry>();
    const uniqueMaterials = new Set<THREE.Material>();
    const uniqueTextures = new Set<THREE.Texture>();

    const counts: SceneCounts = {
      categories: {
        Mesh: 0, Light: 0, Camera: 0, Scene: 0, Group: 0,
        Sprite: 0, Object3D: 0, Geometry: 0, Material: 0,
        Texture: 0, Other: 0,
      },
      threejsConstructors: {},
      userConstructors: {},
    };

    try {
      this.scene.traverse((obj: THREE.Object3D) => {
        // --- TEMPORARY DEBUG --- Keep this for now if needed
        console.log(`[VibeWatchdog DEBUG] Traversing: ${obj.constructor.name}`, obj);
        // --- END DEBUG --- 

        const constructorName = obj.constructor.name;
        let effectiveType = constructorName; // Start with the constructor name

        // Fallback for generic containers: Use object.name if it's meaningful
        if ((constructorName === 'Group' || constructorName === 'Object3D') && obj.name && obj.name !== '') {
            // Basic check: Is the name different from the generic constructor name?
            // You could add more heuristics here if needed (e.g., check against known THREE types)
            if (obj.name !== constructorName) { 
                effectiveType = obj.name; 
                // console.log(`[VibeWatchdog DEBUG] Using object.name '${obj.name}' as effectiveType for generic ${constructorName}`);
            }
        }

        let isCategorized = false;

        // Skip manually excluded types entirely (using effectiveType)
        if (this.excludedTypes.has(effectiveType)) {
          return;
        }

        // Categorize constructor based on effectiveType
        if (knownThreejsTypes.has(effectiveType)) {
          counts.threejsConstructors[effectiveType] = (counts.threejsConstructors[effectiveType] || 0) + 1;
        } else {
          // Assume it's a user constructor if not known and not excluded
          counts.userConstructors[effectiveType] = (counts.userConstructors[effectiveType] || 0) + 1;
        }

        // Increment broad categories based on object type using type guards (original constructor matters here)
        if ('isMesh' in obj && obj.isMesh) {
          counts.categories.Mesh++;
          isCategorized = true;
          const mesh = obj as THREE.Mesh;
          if (mesh.geometry) uniqueGeometries.add(mesh.geometry);
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(mat => { if (mat) uniqueMaterials.add(mat); });
          } else if (mesh.material) {
            uniqueMaterials.add(mesh.material);
          }
        } else if ('isLight' in obj && obj.isLight) {
          counts.categories.Light++;
          isCategorized = true;
        } else if ('isCamera' in obj && obj.isCamera) {
          counts.categories.Camera++;
          isCategorized = true;
        } else if ('isScene' in obj && obj.isScene) {
          counts.categories.Scene++;
          isCategorized = true;
        } else if ('isGroup' in obj && obj.isGroup) {
          counts.categories.Group++;
          isCategorized = true;
        } else if ('isSprite' in obj && obj.isSprite) {
          counts.categories.Sprite++;
          isCategorized = true;
        }

        // If it's an Object3D but not one of the more specific types above
        if (!isCategorized && ('isObject3D' in obj && obj.isObject3D)) {
           counts.categories.Object3D++;
           isCategorized = true;
        }

        // If it wasn't categorized by any known THREE type check
        if (!isCategorized) {
          counts.categories.Other++;
        }
      });

      // Count unique geometries, materials, and their textures
      counts.categories.Geometry = uniqueGeometries.size;
      counts.categories.Material = uniqueMaterials.size;

      uniqueMaterials.forEach(material => {
        const matAny = material as any;
        for (const prop of ['map', 'envMap', 'aoMap', 'alphaMap', 'bumpMap', 'displacementMap', 'emissiveMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap', 'specularMap', 'gradientMap']) {
            const tex = matAny[prop] as THREE.Texture | null;
            if (tex && tex.isTexture) {
                uniqueTextures.add(tex);
            }
        }
      });
      counts.categories.Texture = uniqueTextures.size;

      // --- Logging Output --- 
      const logCounts = (label: string, countObj: { [key: string]: number }) => {
          const sortedEntries = Object.entries(countObj).sort(([a], [b]) => a.localeCompare(b));
          if (sortedEntries.length > 0) {
              console.log(`[VibeWatchdog] ${label}:`, Object.fromEntries(sortedEntries));
          }
      }
      console.log('[VibeWatchdog] --- Traversal Complete ---');
      logCounts('Scene Categories', counts.categories);
      logCounts('THREE.js Constructors', counts.threejsConstructors);
      logCounts('User Constructors', counts.userConstructors);
      console.log('[VibeWatchdog] --------------------------');
      
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
      const urlWithToken = `${this.backendUrl}?token=${encodeURIComponent(this.token || '')}`;
      this.ws = new WebSocket(urlWithToken);

      this.ws.onopen = () => {
        console.log('[VibeWatchdog] WebSocket connection established.');
        this.isConnected = true;
      };

      this.ws.onmessage = (event) => {
        console.log('[VibeWatchdog] Received message from backend:', event.data);
        this.handleBackendCommand(event.data);
      };

      this.ws.onerror = (event) => {
        console.error('[VibeWatchdog] WebSocket error:', event);
        this.isConnected = false;
      };

      this.ws.onclose = (event) => {
        console.log(`[VibeWatchdog] WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
        this.isConnected = false;
        this.ws = null;
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
      console.log('[VibeWatchdog] Would send data (WebSocket not connected): ', data);
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
        // TODO: Implement command handling
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
    this.excludedTypes.clear(); // Clear excluded types
    console.log('[VibeWatchdog] Client disposed.');
  }
}

// Export a singleton instance
export const vibeWatchdog = new VibeWatchdogClient(); 