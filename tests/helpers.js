// Shared helpers for browser tests
const http = require('node:http');

// Test hosts are resolved to 127.0.0.1 by browser settings (see tests)
const PORT = Number(process.env.TEST_PORT || 8765);
const SITE = `http://app.example.co.uk:${PORT}/`;
const OTHER_SITE = `http://other.example.co.uk:${PORT}/`;

// Echo server: the page body shows cookies sent by the browser
function startServer() {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            res.end('cookie=' + (req.headers.cookie || ''));
        });
        server.listen(PORT, () => resolve(server));
    });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Retries the check until it passes or timeout expires (async browser events)
async function eventually(check, timeout = 5000) {
    const start = Date.now();
    let lastError;
    while (Date.now() - start < timeout) {
        try {
            return await check();
        } catch (e) {
            lastError = e;
            await sleep(100);
        }
    }
    throw lastError;
}

module.exports = { PORT, SITE, OTHER_SITE, startServer, sleep, eventually };
