import {
  getSystemStats,
  openApplication,
  setVolume,
  lockWorkstation,
  getRunningProcesses
} from '../system/controller'

export type ToolName =
  | 'get_system_stats'
  | 'open_application'
  | 'set_volume'
  | 'lock_workstation'
  | 'list_top_processes'

export type ToolCall = {
  name: ToolName
  args: Record<string, unknown>
}

export type ToolResult = { output: string; data?: unknown }

export async function executeTool(name: ToolName, args: Record<string, unknown> = {}): Promise<ToolResult> {
  switch (name) {
    case 'get_system_stats': {
      const stats = await getSystemStats()
      return {
        output: `CPU ${stats.cpuLoad}%, RAM ${stats.memoryUsedPercent}% (${stats.memoryUsedGb}/${stats.memoryTotalGb} GB), Disk ${stats.diskUsedPercent}%, Uptime ${stats.uptimeHours}h`,
        data: stats
      }
    }
    case 'open_application':
      return { output: await openApplication(String(args.name ?? '')) }
    case 'set_volume':
      return { output: await setVolume(Number(args.level ?? 50)) }
    case 'lock_workstation':
      return { output: await lockWorkstation() }
    case 'list_top_processes':
      return { output: await getRunningProcesses() }
    default:
      return { output: `Unknown tool: ${name}` }
  }
}

export const TOOL_DEFINITIONS = [
  {
    name: 'get_system_stats' as const,
    description: 'Get current CPU, memory, disk, and uptime stats'
  },
  {
    name: 'open_application' as const,
    description: 'Open a Windows application by name'
  },
  {
    name: 'set_volume' as const,
    description: 'Set system volume from 0 to 100'
  },
  {
    name: 'lock_workstation' as const,
    description: 'Lock the Windows workstation'
  },
  {
    name: 'list_top_processes' as const,
    description: 'List top memory-consuming processes'
  }
]
