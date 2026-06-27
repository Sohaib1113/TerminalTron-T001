import si from 'systeminformation'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { SystemStats } from '@shared/types'

const execAsync = promisify(exec)

export async function getSystemStats(): Promise<SystemStats> {
  const [cpuLoad, mem, disk, osInfo, time] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.osInfo(),
    si.time()
  ])

  let cpuTemp: number | null = null
  try {
    const temps = await si.cpuTemperature()
    cpuTemp = temps.main > 0 ? Math.round(temps.main) : null
  } catch {
    cpuTemp = null
  }

  const primaryDisk = disk[0]
  const memoryUsedGb = Math.round((mem.active / 1024 ** 3) * 10) / 10
  const memoryTotalGb = Math.round((mem.total / 1024 ** 3) * 10) / 10

  return {
    cpuLoad: Math.round(cpuLoad.currentLoad),
    cpuTemp,
    memoryUsedPercent: Math.round((mem.used / mem.total) * 100),
    memoryUsedGb,
    memoryTotalGb,
    diskUsedPercent: primaryDisk ? Math.round(primaryDisk.use) : 0,
    uptimeHours: Math.round((time.uptime / 3600) * 10) / 10,
    hostname: osInfo.hostname,
    platform: `${osInfo.distro || osInfo.platform} ${osInfo.release}`
  }
}

export async function openApplication(name: string): Promise<string> {
  const apps: Record<string, string> = {
    notepad: 'notepad',
    calculator: 'calc',
    calc: 'calc',
    explorer: 'explorer',
    chrome: 'start chrome',
    edge: 'start msedge',
    spotify: 'start spotify',
    vscode: 'code',
    cursor: 'cursor',
    terminal: 'wt',
    settings: 'start ms-settings:'
  }

  const key = name.toLowerCase().trim()
  const command = apps[key] ?? `start ${name}`

  await execAsync(command, { shell: 'powershell.exe' })
  return `Opened ${name}.`
}

export async function setVolume(level: number): Promise<string> {
  const clamped = Math.max(0, Math.min(100, level))
  const ps = `$obj = New-Object -ComObject WScript.Shell; 1..50 | ForEach-Object { $obj.SendKeys([char]174) }; 1..${Math.round(clamped / 2)} | ForEach-Object { $obj.SendKeys([char]175) }`
  await execAsync(`powershell -Command "${ps}"`, { shell: 'powershell.exe' })
  return `Volume set to ${clamped}%.`
}

export async function lockWorkstation(): Promise<string> {
  await execAsync('rundll32.exe user32.dll,LockWorkStation')
  return 'Workstation locked.'
}

export async function getRunningProcesses(limit = 8): Promise<string> {
  const procs = await si.processes()
  const top = procs.list
    .filter((p) => p.memRss > 0)
    .sort((a, b) => b.memRss - a.memRss)
    .slice(0, limit)
    .map((p) => `${p.name} (${Math.round(p.memRss / 1024 / 1024)} MB)`)

  return top.join('\n')
}

export async function runPowerShell(command: string): Promise<string> {
  const blocked = ['format', 'remove-item -recurse c:', 'shutdown /s', 'del /f /s /q']
  const lower = command.toLowerCase()
  if (blocked.some((b) => lower.includes(b))) {
    throw new Error('Command blocked for safety.')
  }

  const { stdout, stderr } = await execAsync(command, {
    shell: 'powershell.exe',
    timeout: 15000
  })

  return (stdout || stderr || 'Command completed.').trim()
}
