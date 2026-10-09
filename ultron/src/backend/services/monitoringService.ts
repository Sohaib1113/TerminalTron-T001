import si from 'systeminformation';
import prisma from '../db';

export interface MetricSnapshot {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  processCount: number;
  timestamp: string;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

const round = (value: number) => Math.round(value * 10) / 10;

const THRESHOLDS = {
  cpu: { warning: 80, critical: 90 },
  memory: { warning: 85, critical: 92 },
  disk: { warning: 85, critical: 92 },
} as const;

const ALERT_COOLDOWN_MS = 10 * 60 * 1000;
const PRUNE_KEEP_COUNT = 2000;

const alertCooldowns = new Map<string, number>();

let tickTimer: NodeJS.Timeout | null = null;
let pruneTimer: NodeJS.Timeout | null = null;

const getDefaultUser = async () => {
  return prisma.user.upsert({
    where: { username: 'ultron-system' },
    update: {},
    create: {
      username: 'ultron-system',
      email: 'ultron@local',
      password: '',
    },
  });
};

const collect = async (): Promise<MetricSnapshot> => {
  const [cpu, mem, fs, procs] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.processes(),
  ]);

  const totalFs = fs.reduce((sum, mount) => sum + (mount.size || 0), 0);
  const usedFs = fs.reduce((sum, mount) => sum + (mount.used || 0), 0);

  return {
    cpuUsage: round(cpu.currentLoad ?? 0),
    memoryUsage: mem.total > 0 ? round((mem.used / mem.total) * 100) : 0,
    diskUsage: totalFs > 0 ? round((usedFs / totalFs) * 100) : 0,
    processCount: procs.all ?? 0,
    timestamp: new Date().toISOString(),
  };
};

const evaluateThresholds = async (snapshot: MetricSnapshot, userId: string): Promise<number> => {
  const checks = [
    { type: 'cpu' as const, value: snapshot.cpuUsage, label: 'CPU usage' },
    { type: 'memory' as const, value: snapshot.memoryUsage, label: 'Memory usage' },
    { type: 'disk' as const, value: snapshot.diskUsage, label: 'Disk usage' },
  ];

  let created = 0;

  for (const check of checks) {
    const threshold = THRESHOLDS[check.type];
    const severity: AlertSeverity | null =
      check.value >= threshold.critical
        ? 'critical'
        : check.value >= threshold.warning
          ? 'warning'
          : null;

    if (!severity) {
      continue;
    }

    const key = `${check.type}:${severity}`;
    const now = Date.now();
    const lastAlertAt = alertCooldowns.get(key) ?? 0;

    if (now - lastAlertAt < ALERT_COOLDOWN_MS) {
      continue;
    }

    alertCooldowns.set(key, now);

    await prisma.monitoringAlert.create({
      data: {
        userId,
        type: check.type,
        severity,
        message: `${check.label} is at ${check.value}% (${severity} threshold ${threshold[severity]}%)`,
      },
    });

    created += 1;
  }

  return created;
};

/**
 * Collects a snapshot and, by default, persists the SystemMetrics row and
 * evaluates threshold alerts against the current user.
 */
const takeSnapshot = async (opts?: { persist?: boolean }): Promise<MetricSnapshot> => {
  const snapshot = await collect();

  if (opts?.persist !== false) {
    await prisma.systemMetrics.create({
      data: {
        cpuUsage: snapshot.cpuUsage,
        memoryUsage: snapshot.memoryUsage,
        diskUsage: snapshot.diskUsage,
        processCount: snapshot.processCount,
      },
    });

    const user = await getDefaultUser();
    await evaluateThresholds(snapshot, user.id);
  }

  return snapshot;
};

const pruneOldMetrics = async () => {
  const keep = await prisma.systemMetrics.findMany({
    orderBy: { timestamp: 'desc' },
    select: { id: true },
    take: PRUNE_KEEP_COUNT,
  });

  if (keep.length < PRUNE_KEEP_COUNT) {
    return;
  }

  const keepIds = keep.map((row) => row.id);
  const result = await prisma.systemMetrics.deleteMany({
    where: { id: { notIn: keepIds } },
  });

  if (result.count > 0) {
    console.log(`[monitoring] pruned ${result.count} old metric rows`);
  }
};

const shouldMonitor = async (): Promise<boolean> => {
  if ((process.env.ENABLE_MONITORING ?? 'true') !== 'true') {
    return false;
  }

  try {
    const user = await getDefaultUser();
    const settings = await prisma.appSettings.findUnique({
      where: { userId: user.id },
    });
    return settings ? settings.monitoringEnabled : true;
  } catch (error) {
    return true;
  }
};

/**
 * Starts the background sampling loop. Reads ENABLE_MONITORING and
 * MONITORING_INTERVAL from the environment and honors the persisted
 * `monitoringEnabled` app setting on every tick.
 */
export const startMonitoring = async () => {
  const intervalMs = Math.max(Number(process.env.MONITORING_INTERVAL || 5000), 1000);

  const tick = async () => {
    try {
      if (!(await shouldMonitor())) {
        return;
      }
      await takeSnapshot({ persist: true });
    } catch (error) {
      console.error('[monitoring] tick failed', error);
    }
  };

  void tick();
  tickTimer = setInterval(tick, intervalMs);
  pruneTimer = setInterval(pruneOldMetrics, 10 * 60 * 1000);

  console.log(`[monitoring] started (interval ${intervalMs}ms)`);
};

export const stopMonitoring = () => {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
};

export default {
  collect,
  takeSnapshot,
  startMonitoring,
  stopMonitoring,
  pruneOldMetrics,
};