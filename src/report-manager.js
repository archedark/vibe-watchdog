const fs = require('fs').promises;
const path = require('path');

// Function to extract timestamp from filename (moved from watchdog.js)
// Remains a standalone function as it's primarily used within getReports
function getTimestampFromFilename(filename) {
    // filename format: report-YYYY-MM-DDTHH-MM-SSZ.json
    const timestampPart = filename.substring(7, filename.length - 5); // e.g., "YYYY-MM-DDTHH-MM-SSZ"
    // Restore colons in the time part: HH-MM-SS -> HH:MM:SS
    // Ensure T separator is present
    const isoTimestamp = timestampPart.substring(0, 10) + 'T' + timestampPart.substring(11).replace(/-/g, ':');
    // Now isoTimestamp should be "YYYY-MM-DDTHH:MM:SSZ" which is valid ISO 8601
    const date = new Date(isoTimestamp);
    if (isNaN(date.getTime())) { // Check if parsing failed
        console.warn(`Failed to parse timestamp from filename: ${filename} (Constructed ISO: ${isoTimestamp})`);
        return null; // Return null to indicate failure
    }
    return date.getTime(); // Return milliseconds since epoch
}

// Internal helper function for managing report rotation
async function manageReportsInternal(dir, maxReportsToKeep) {
    try {
        const files = await fs.readdir(dir);
        const reportFiles = files
            .filter(f => f.startsWith('report-') && f.endsWith('.json'))
            .map(f => {
                const timestampMillis = getTimestampFromFilename(f); // Use the existing parser
                return {
                    name: f,
                    // Use parsed time; handle potential null from parser
                    time: timestampMillis === null ? -Infinity : timestampMillis
                };
            })
            // Filter out files where timestamp parsing failed before sorting
            .filter(f => f.time !== -Infinity)
            .sort((a, b) => a.time - b.time); // Sort oldest first

        if (reportFiles.length > maxReportsToKeep) {
            const filesToDelete = reportFiles.slice(0, reportFiles.length - maxReportsToKeep);
            console.log(`Rotating reports: Keeping ${maxReportsToKeep}, removing ${filesToDelete.length} oldest reports in ${path.basename(dir)}.`);
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
        console.error(`Error managing reports in ${path.basename(dir)}:`, err.message);
    }
}

class ReportManager {
    constructor(reportsDirRoot, reportsDirSubName = 'reports') {
        this.reportsDir = path.join(reportsDirRoot, reportsDirSubName);
        console.log(`ReportManager initialized. Reports directory: ${this.reportsDir}`);
    }

    async initializeDirectory() {
        try {
            await fs.mkdir(this.reportsDir, { recursive: true });
        } catch (err) {
            console.error(`Error creating reports directory (${this.reportsDir}):`, err.message);
            throw err; // Re-throw error to potentially stop initialization
        }
    }

    async clearReports() {
        console.log(`Removing existing reports from ${this.reportsDir}...`);
        try {
            const files = await fs.readdir(this.reportsDir);
            const reportFiles = files.filter(f => f.startsWith('report-') && f.endsWith('.json'));
            if (reportFiles.length > 0) {
                let deletedCount = 0;
                for (const file of reportFiles) {
                    try {
                        await fs.unlink(path.join(this.reportsDir, file));
                        deletedCount++;
                    } catch (delErr) {
                        console.warn(`  - Failed to delete report ${file}:`, delErr.message);
                    }
                }
                console.log(`  Deleted ${deletedCount} report file(s).`);
            } else {
                console.log('  No existing reports found to delete.');
            }
        } catch (err) {
            // If directory doesn't exist, that's fine, initialization should handle it
            if (err.code === 'ENOENT') {
                 console.log('  Reports directory does not exist yet, nothing to clear.');
            } else {
                console.error('  Error reading reports directory for clearing:', err.message);
                // Optional: Decide if this is fatal.
            }
        }
    }

    async saveReport(reportData, maxReports) {
        const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '') + 'Z'; // Format: YYYY-MM-DDTHH-MM-SSZ
        const filename = `report-${timestamp}.json`;
        const filepath = path.join(this.reportsDir, filename);

        try {
            await fs.writeFile(filepath, JSON.stringify(reportData, null, 2));
            console.log(`Report saved: ${path.join(path.basename(this.reportsDir), filename)}`);
            // Call internal manage function after successful save
            await manageReportsInternal(this.reportsDir, maxReports);
        } catch (err) {
            console.error(`Error saving report ${filename} to ${this.reportsDir}:`, err.message);
        }
    }

    async getReports() {
        try {
            const files = await fs.readdir(this.reportsDir);
            const reportFiles = files.filter(f => f.startsWith('report-') && f.endsWith('.json'));

            let reportsData = [];
            for (const file of reportFiles) {
                const filepath = path.join(this.reportsDir, file);
                try {
                    const content = await fs.readFile(filepath, 'utf-8');
                    const reportJson = JSON.parse(content);
                    // Add timestamp from filename for sorting
                    const timestampMillis = getTimestampFromFilename(file); // Get ms
                    if (timestampMillis === null) {
                         console.warn(`Skipping report file due to invalid timestamp in filename: ${file}`);
                         continue; // Skip this file if timestamp is invalid
                    }
                    reportJson.timestamp = new Date(timestampMillis).toISOString(); // Convert ms back to ISO string
                    reportsData.push(reportJson);
                } catch (readErr) {
                    console.warn(`Failed to read or parse report file ${file}:`, readErr.message);
                    // Optionally skip this file or include an error marker
                }
            }

            // Sort reports by timestamp, newest first
            reportsData.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

            return reportsData;
        } catch (err) {
            // If dir doesn't exist, return empty array
            if (err.code === 'ENOENT') {
                console.log(`Reports directory ${this.reportsDir} not found, returning empty array.`);
                return [];
            }
            console.error(`Error retrieving reports from ${this.reportsDir}:`, err.message);
            throw err; // Re-throw other errors to be handled by the server endpoint
        }
    }
}

module.exports = ReportManager;
