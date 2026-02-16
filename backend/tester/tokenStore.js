const fs = require('fs');
const path = require('path');

const profile = (process.env.TESTER_PROFILE || '').trim();
const TOKEN_FILE = profile
    ? path.join(__dirname, `.tester_state.${profile}.json`)
    : path.join(__dirname, '.tester_state.json');

function loadState() {
    if (!fs.existsSync(TOKEN_FILE)) {
        return {};
    }
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
}

function saveState(state) {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(state, null, 2));
}

module.exports = { loadState, saveState };
