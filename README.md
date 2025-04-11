<img src="assets/vibe-watchdog-icon.png" alt="Vibe Watchdog" width="192">

# Vibe Watchdog

Is your THREE.js game or interactive vibe slowing down over time? ✨ Vibe Watchdog helps you spot memory leaks and resource buildup in your project—no advanced technical skills needed! It's designed specifically for vibe coders and beginners.

Think of it like keeping a tidy room: some mess is okay, but if clutter keeps building and isn't cleaned up, things become chaotic. Vibe Watchdog helps you keep your digital space clean and running smoothly.

**Choose Your Monitoring Method:**

1.  **Snapshot Mode:** Easiest setup. Sees *everything* in memory, good for catching all potential leaks. Can cause brief pauses in your game when taking snapshots.
2.  **Agent Mode:** Lightweight & fast. Requires a small code change. Tracks only objects *actively* in your THREE.js scene graph.

---

## Option 1: Snapshot Mode (Heavier Tracking)

This mode automatically opens your project's URL and takes periodic snapshots of *all objects* in memory. It's simple to use and gives you a broad overview without needing to touch your code.

**Why Use It?**
*   **Sees Everything:** Catches memory leaks even if objects aren't directly in your visible scene.
*   **Zero Code Changes:** Works on any web URL instantly.
*   **Simple Setup:** Just run one command.

**Keep in Mind:**
*   **Performance Hiccups:** Taking a full memory snapshot can briefly pause your game or cause a stutter.
*   **Less Frequent:** Snapshots are usually taken less often (e.g., every 10 seconds) because they are resource-intensive.

### 🚀 Quick Start

Clone and install (only need to do this once):

```bash
git clone https://github.com/archedark/vibe-watchdog.git
cd vibe-watchdog
npm install
```

Run the Watchdog:

```bash
node watchdog.js --url http://localhost:[YOUR_GAME_PORT]
```
Replace `[YOUR_GAME_PORT]` with your game's port number (e.g., 8080).

View results at:
```
http://localhost:1109
```

You'll see charts showing memory usage. If objects keep increasing without dropping, it might signal a memory leak.

---

## Option 2: Agent Mode (Lightweight Tracking)

Agent Mode adds a tiny library to your game code to continuously track active objects directly in your THREE.js scene. It's faster and lighter on performance, but won't capture anything not directly attached to your THREE.js scene.

**Why Use It?**
*   **Lightweight:** Minimal performance impact on your game, runs smoothly in the background.
*   **Fast Updates:** See changes in your active scene objects very frequently (e.g., every 1-5 seconds).
*   **Detailed Scene View:** Tracks specific types of objects currently in use in the scene.

**Keep in Mind:**
*   **Requires Simple Code Change:** You need to install a library and add ~5 lines of code to your project.
*   **Scene-Only Scope:** It *only* sees objects added to the specific THREE.js scene you tell it about. It cannot see objects managed elsewhere in your code (like UI elements in HTML, data in separate arrays, or detached objects).

### 🛠 Setup (Local Development / Testing)

These steps are for using the Agent Mode locally *before* it's published as a package.

**1. Build & Link the Client Library**

*   Open a terminal inside the `vibe-watchdog/vibe-watchdog-client` directory.
*   Build the library code:
    ```bash
    npm run build
    ```
*   Make the built library available locally:
    ```bash
    npm link
    ```

**2. Link Library to Your Game Project**

*   Open a terminal inside *your game project's* directory.
*   Link the watchdog client library into your game's `node_modules`:
    ```bash
    npm link @vibewatchdog/client
    ```
    *(You only need to do steps 1 & 2 once, unless you change client library dependencies)*

**3. Integrate with Your Game Code**

In your main game file where you create your `THREE.Scene`:

```javascript
import { vibeWatchdog } from '@vibewatchdog/client';

const myGameScene = new THREE.Scene();
// ...your game setup...

vibeWatchdog.init({
  scene: myGameScene,           // Your game's main scene
  token: 'local-dev',           // Local testing token
  backendUrl: 'ws://localhost:1110' // Local data URL
});
```

Replace `myGameScene` with your actual THREE.js scene.

**🤖 Using an AI Assistant?**

If you're using an AI coding assistant (like the one writing this README - hi! 👋), you can give it the following prompt to handle this step for you:

> ```text
> Integrate the Vibe Watchdog client library for performance monitoring.
> 
> 1.  **Import the library:** Add the following import statement at the top of the relevant file (where your main scene logic resides):
>     ```javascript
>     import { vibeWatchdog } from '@vibewatchdog/client';
>     ```
> 
> 2.  **Locate the THREE.js Scene:** Find the part of the code where the primary `THREE.Scene` object is created or is accessible.
> 
> 3.  **Initialize Vibe Watchdog:** Immediately after the scene object is available, add the following line to initialize the monitoring:
>     ```javascript
>     vibeWatchdog.init({
>       scene: scene, // Replace 'scene' with the actual variable name of your main THREE.Scene object
>       token: 'local-dev', // Using a placeholder token for local testing
>       backendUrl: 'ws://localhost:1110' // Added for local testing
>     });
>     ```
>     Make sure to replace `scene` in the code above with the correct variable name holding your game's main `THREE.Scene` instance.
> ```

**(Important!) Rebuild if you change library code:** If you modify the code inside `vibe-watchdog-client/src`, you must re-run `npm run build` in the `vibe-watchdog-client` directory for your game project to see the changes.

**4. Start the Listener**

From your `vibe-watchdog` directory (in a separate terminal):

```bash
node watchdog.js --listen
```

**5. View your data at:**
```
http://localhost:1109
```

You'll see updated charts every few seconds showing active scene objects.

**Which Mode Should I Choose?**
*   Start with **Snapshot Mode** for a quick check, especially if you suspect leaks outside the main scene or don't want to modify code.
*   Use **Agent Mode** for more continuous, low-impact monitoring focused on the performance and structure of your active scene graph.

---

## 📋 Command-Line Options

Common options for both modes:
```
--help                 Displays help message.
--max-reports <num>    Number of data points to store (Default: Snapshot=20, Agent=240).
--port <num>           Dashboard port (Default: 1109).
--clear-reports        Clears old reports at start (Default: Snapshot=no, Agent=yes).
```

Snapshot Mode specifics:
```
--url <url>            REQUIRED: URL of your game.
--headless             Run without visible browser window (Default: no).
--interval <ms>        Snapshot interval (Default: Snapshot=20000, Agent=5000).
--threshold <count>    Warning threshold for consecutive increases (Default: 3).
```

Agent Mode specifics:
```
--listen               REQUIRED: Activates listener for agent data.
--wss-port <port>      Listener port for agent data (Default: 1110).
```

---

## 🖥 Hosted Version

Want even more powerful features, including AI analysis and automatic integration with your codebase for fast, detailed tracking? Our hosted version is coming soon at [vibewatchdog.com](https://vibewatchdog.com)—join the waitlist!

---

## 💖 Feedback & Contributions

Have an idea or found an issue? We'd love your feedback:
*   Create a [GitHub Issue](https://github.com/archedark/vibe-watchdog/issues)
*   Submit Pull Requests
*   Reach out on X [@archedark_](https://x.com/archedark_)

---

Happy vibe coding! ✨🎨👾

