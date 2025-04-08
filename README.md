<img src="assets/vibe-watchdog-icon.png" alt="Vibe Watchdog" width="192">

# Vibe Watchdog

Vibe Watchdog is a simple yet powerful tool designed specifically for beginners and vibe coders building games or interactive experiences with [THREE.js](https://threejs.org/). It helps you monitor memory usage over time to identify leaks or unexpected increases in resources—without needing deep technical knowledge.

If you're vibe coding your first game or app vibe with AI, Vibe Watchdog is your companion to make sure your creations run smoothly and efficiently!

---

## 🚀 Quick Start

### 1. Clone this repo
```bash
git clone https://github.com/archedark/vibe-watchdog.git
cd vibe-watchdog
```

### 2. Install Dependencies
Make sure you have [Node.js](https://nodejs.org/) installed.

```bash
npm install
```

### 3. Run the Watchdog
Launch Vibe Watchdog pointing at your game URL. Example:

```bash
node watchdog.js --url https://localhost:[YOUR PORT]
```

Replace `[YOUR PORT]` with the port number your game is running on for development.

This opens a browser window (by default visible, but you can use `--headless` to hide it) and monitors memory usage at regular intervals.

### 🎮 View the Results
In the browser you'll see Vibe Watchdog running at:
```
http://localhost:1109
```

A simple dashboard displays memory usage trends, with visuals to help you spot potential leaks or issues! Play your game and keep an eye on the chart. If some object keeps accumulating, that's a sign that those resources aren't getting cleaned up.

---

## 🛠 Optional Settings

You can customize Vibe Watchdog using these optional parameters:

- `--headless`: Run without opening a visible browser.
- `--interval <ms>`: Adjust how often memory snapshots are taken (default: 10000ms = 10 seconds).
- `--threshold <count>`: Number of consecutive resource increases to trigger leak warnings (default: 3).
- `--max-reports <num>`: Number of snapshots to retain (default: 20).
- `--port <num>`: Change the web dashboard port (default: 3000).
- `--clear-reports`: Clear previous reports when starting.

Example with options:
```bash
node watchdog.js --url https://localhost:[YOUR PORT] --max-reports 50 --interval 5000 --threshold 5
```

---

## 🌠 How It Works

Vibe Watchdog opens your game and regularly checks memory usage, specifically tracking THREE.js objects like geometries, materials, textures, and meshes. It saves these snapshots and visually represents memory usage over time, making it easy to detect patterns or leaks that might slow down your game.

---

## 🖥 Hosted Version

If you'd prefer a no-setup solution with extra features and easy access, check out our hosted version at [vibewatchdog.com](https://vibewatchdog.com).

The hosted service offers:

- No installation required
- Enhanced dashboards
- Custom filters
- AI analysis
- Historical data tracking

(Vibe coding is underway, so join our waitlist!)

---

## 💖 Feedback & Contributions

We built this tool with vibe coders in mind, and your feedback is invaluable. Have ideas or run into issues?

- Create a [GitHub Issue](https://github.com/archedark/vibe-watchdog/issues)
- Contribute with pull requests
- Say hi on X [@archedark_](https://x.com/archedark_)

---

Happy vibe coding! ✨🎨👾

