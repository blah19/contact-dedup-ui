#!/usr/bin/env node
/*
 Dev start orchestrator:
 - loads .env and .env.local into process.env
 - derives VITE_SF_* vars
 - determines target PORT (from env PORT or VITE_SF_REDIRECT_URI)
 - tries to kill stale listeners on common vite ports and the target port
 - attempts to start vite with --port <PORT> --strictPort
 - if bind fails, starts vite on fallback port 5173 and creates a TCP forwarder from target -> 5173

This script is intended for development convenience only.
*/
const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const net = require('net')

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return
  const txt = fs.readFileSync(file, 'utf8')
  for (const line of txt.split(/\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    let [, k, v] = m
    // strip optional surrounding quotes
    v = v.replace(/^"|"$/g, '')
    process.env[k] = v
  }
}

const root = path.join(__dirname, '..')
loadDotEnv(path.join(root, '.env'))
loadDotEnv(path.join(root, '.env.local'))

// Derive VITE variables if not set
process.env.VITE_SF_INSTANCE = process.env.VITE_SF_INSTANCE || process.env.AUTH_DOMAIN || process.env.SF_INSTANCE || ''
process.env.VITE_SF_CLIENT_ID = process.env.VITE_SF_CLIENT_ID || process.env.CLIENT_ID || ''
process.env.VITE_SF_REDIRECT_URI = process.env.VITE_SF_REDIRECT_URI || process.env.REDIRECT_URI || ''

function extractPortFromUri(uri) {
  if (!uri) return null
  const m = uri.match(/:(\d+)(?:\/|$)/)
  return m ? parseInt(m[1], 10) : null
}

const targetPort = process.env.PORT ? parseInt(process.env.PORT, 10) : (extractPortFromUri(process.env.VITE_SF_REDIRECT_URI) || 5173)
const fallbackPort = 5173

console.log(`Starting dev (targetPort=${targetPort}, fallbackPort=${fallbackPort})`)

function isPortInUse(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
    tester.once('error', () => resolve(true))
    tester.once('listening', () => tester.close(() => resolve(false)))
    tester.listen(port, '127.0.0.1')
  })
}

function killPidsOnPort(port) {
  try {
    // Use lsof to find pids; ignore errors if lsof not available
    const out = execSync(`lsof -ti :${port}`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim()
    if (!out) return
    const pids = out.split(/\n/).filter(Boolean)
    for (const pid of pids) {
      if (parseInt(pid, 10) === process.pid) continue
      try { process.kill(parseInt(pid, 10), 'SIGTERM') } catch (e) {}
    }
  } catch (e) {
    // ignore
  }
}

async function waitForPortFree(port, timeoutSec = 10) {
  const start = Date.now()
  while ((Date.now() - start) / 1000 < timeoutSec) {
    const used = await isPortInUse(port)
    if (!used) return true
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

async function startVite(port, strict = true) {
  const viteBin = path.join(root, 'node_modules', '.bin', 'vite')
  const args = [ '--port', String(port) ]
  if (strict) args.push('--strictPort')
  console.log(`Spawning vite ${args.join(' ')}`)
  const p = spawn(viteBin, args, { stdio: 'inherit', env: { ...process.env } })
  return p
}

function startForwarder(listenPort, toPort) {
  const server = net.createServer((src) => {
    const dst = net.connect({ port: toPort, host: '127.0.0.1' })
    src.pipe(dst)
    dst.pipe(src)
    src.on('error', () => { try { dst.destroy() } catch {} })
    dst.on('error', () => { try { src.destroy() } catch {} })
  })
  server.listen(listenPort, '127.0.0.1')
  server.on('listening', () => console.log(`Forwarder listening on ${listenPort} -> 127.0.0.1:${toPort}`))
  server.on('error', (err) => console.error('Forwarder error', err && err.message))
  return server
}

(async () => {
  // Kill common vite ports and target
  const portsToCheck = [fallbackPort, fallbackPort+1, fallbackPort+2, fallbackPort+3, targetPort]
  for (const p of portsToCheck) {
    killPidsOnPort(p)
  }

  // Wait briefly for sockets to close
  await waitForPortFree(targetPort, 5)

  // Try to start vite on the target port
  let viteProcess = null
  try {
    viteProcess = await startVite(targetPort, true)
    viteProcess.on('exit', (code, sig) => {
      if (code !== 0) console.error(`vite exited with code ${code} sig ${sig}`)
      process.exit(code === null ? 0 : code)
    })
    // if the process starts, just wait (stdio inherited)
    viteProcess.on('error', async (err) => {
      console.error('vite start error', err && err.message)
      // fall through to fallback logic
    })
  } catch (e) {
    console.error('Failed to spawn vite on target port, falling back', e && e.message)
  }

  // Give it a short moment to bind; check if the target port is actually in use by vite
  await new Promise(r => setTimeout(r, 1500))
  const inUse = await isPortInUse(targetPort)
  if (inUse) {
    console.log(`Vite is listening on target port ${targetPort}`)
    return
  }

  // Otherwise, fallback: start vite on fallbackPort and forward targetPort -> fallbackPort
  console.log(`Target port ${targetPort} not bound. Starting vite on ${fallbackPort} and forwarding ${targetPort} -> ${fallbackPort}`)
  // kill any pids on fallback
  killPidsOnPort(fallbackPort)
  await waitForPortFree(fallbackPort, 5)
  const viteFallback = await startVite(fallbackPort, false)
  // start forwarder
  const forwarder = startForwarder(targetPort, fallbackPort)

  // wire up exit handling
  const shutdown = () => {
    try { viteFallback.kill() } catch {}
    try { forwarder.close() } catch {}
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
})();
