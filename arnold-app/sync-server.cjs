// Sync server: serves Arnold data from PC so the phone can pull it
// Step 1: Run on PC:  node sync-server.cjs
// Step 2: On phone open: http://localhost:5175/
const http = require('http');
const fs = require('fs');

const PORT = 5175;

// Read the backup from PC's recover tool output, or generate fresh
// We'll serve a page that fetches /data and writes to localStorage
const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Arnold Phone Sync</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#0a0a0a;color:#e0e0e0;font-family:'Segoe UI',system-ui,sans-serif;padding:40px 20px;text-align:center;}
  h1{color:#00e676;font-size:22px;margin-bottom:8px;}
  .sub{color:#888;font-size:13px;margin-bottom:24px;}
  button{background:#00e676;color:#000;border:none;padding:16px 40px;border-radius:12px;font-size:17px;font-weight:700;cursor:pointer;width:90%;max-width:320px;}
  button:active{transform:scale(0.96);}
  .status{margin:20px auto;padding:16px;border-radius:10px;font-size:14px;max-width:400px;line-height:1.5;}
  .ok{background:#1b3a1b;color:#00e676;}
  .err{background:#3a1b1b;color:#f44336;}
  .info{background:#1a1a2e;color:#90caf9;}
  a{color:#00e676;font-weight:600;text-decoration:none;}
</style>
</head>
<body>
<h1>Arnold Phone Sync</h1>
<p class="sub">Pull data from your PC to this device</p>
<button id="btn" onclick="doSync()">Sync Now</button>
<div id="status"></div>
<script>
async function doSync(){
  const btn = document.getElementById('btn');
  const status = document.getElementById('status');
  btn.disabled = true;
  btn.textContent = 'Syncing...';
  status.innerHTML = '<div class="status info">Fetching data from PC...</div>';
  try {
    const resp = await fetch('/api/data');
    if(!resp.ok) throw new Error('Server returned ' + resp.status);
    const data = await resp.json();
    const keys = Object.keys(data).filter(k => k.startsWith('arnold:'));
    if(!keys.length) throw new Error('No arnold:* keys found');

    // Write to localStorage on port 5174 (Arnold's port)
    // But we're on port 5175... we need to redirect after saving here,
    // or save a transfer file. Let's save to 5175 first then use a
    // temporary approach.

    // Actually: write keys to THIS port's localStorage as a staging area
    keys.forEach(k => localStorage.setItem(k, data[k]));

    const totalBytes = keys.reduce((s,k) => s + data[k].length, 0);
    const sizeStr = totalBytes > 1024 ? (totalBytes/1024).toFixed(1)+' KB' : totalBytes+' bytes';

    status.innerHTML = '<div class="status ok">✅ Synced ' + keys.length + ' keys (' + sizeStr + ')<br><br>' +
      'Data is staged. Now:<br>' +
      '<a href="http://localhost:5174/pull-local.html">→ Open Arnold to finish import</a></div>';
    btn.textContent = 'Done!';
  } catch(e) {
    status.innerHTML = '<div class="status err">Error: ' + e.message + '</div>';
    btn.disabled = false;
    btn.textContent = 'Retry';
  }
}
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if(req.url === '/api/data') {
    // Read the backup file if it exists, otherwise tell user to create one
    const backupFiles = fs.readdirSync('.').filter(f => f.startsWith('arnold-backup') && f.endsWith('.json'));

    // Also check Downloads folder
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const dlDir = require('path').join(home, 'Downloads');
    let dlFiles = [];
    try { dlFiles = fs.readdirSync(dlDir).filter(f => f.startsWith('arnold-backup') && f.endsWith('.json')); } catch{}

    let backupPath = null;
    if(backupFiles.length) {
      backupPath = backupFiles.sort().pop(); // newest
    } else if(dlFiles.length) {
      backupPath = require('path').join(dlDir, dlFiles.sort().pop());
    }

    if(!backupPath) {
      res.writeHead(404, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'No backup file found. Go to localhost:5174/recover.html on PC and click Download Backup first.'}));
      return;
    }

    try {
      const data = fs.readFileSync(backupPath, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
      console.log('Served backup:', backupPath, '(' + (data.length/1024).toFixed(1) + ' KB)');
    } catch(e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error: e.message}));
    }
  } else {
    res.writeHead(200, {'Content-Type':'text/html'});
    res.end(page);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  Arnold Sync Server running on port ' + PORT);
  console.log('');
  console.log('  Step 1: Make sure you have a backup file.');
  console.log('          Go to http://localhost:5174/recover.html on PC');
  console.log('          and click "Download Backup"');
  console.log('');
  console.log('  Step 2: On your phone, set up ADB tunnel:');
  console.log('          adb reverse tcp:5175 tcp:5175');
  console.log('');
  console.log('  Step 3: On phone Chrome, open:');
  console.log('          http://localhost:5175/');
  console.log('');
});
