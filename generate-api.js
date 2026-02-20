const fs = require('fs');
const path = require('path');

function scanDirectory(dirPath) {
	const entries = fs.readdirSync(dirPath).sort((a, b) => a.localeCompare(b));
	const result = {};
	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry);
		if (fs.statSync(fullPath).isDirectory()) {
			result[entry] = scanDirectory(fullPath);
		} else {
			result[entry] = null;
		}
	}
	return result;
}

const apiDir = path.join(__dirname, 'src', 'api');
fs.mkdirSync(apiDir, { recursive: true });

const dataStructure = scanDirectory(path.join(__dirname, 'src', 'assets', 'data'));
fs.writeFileSync(path.join(apiDir, 'directory_structure'), JSON.stringify(dataStructure));

const dataMbpStructure = scanDirectory(path.join(__dirname, 'src', 'assets', 'data_mbp'));
fs.writeFileSync(path.join(apiDir, 'directory_structure_mbp'), JSON.stringify(dataMbpStructure));

// Empty customs list (no server-side custom levels in static deploy)
fs.writeFileSync(path.join(apiDir, 'customs'), JSON.stringify([]));

// Copy version_history.md so the home screen can display it
const versionHistoryPath = path.join(__dirname, 'version_history.md');
if (fs.existsSync(versionHistoryPath)) {
	fs.copyFileSync(versionHistoryPath, path.join(apiDir, 'version_history'));
}

console.log('Generated static API files in src/api/');
