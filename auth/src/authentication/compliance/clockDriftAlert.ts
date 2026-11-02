import { createSocket } from 'node:dgram'
import { emitNotification } from '../../notifications.js'
import { listInstanceAdmins } from '../../authzInstanceStore.js'
import { checkClockDrift, generateClockDriftAlert } from './validation.js'

const pollMs = 60 * 1000
const NTP_UNIX_OFFSET = 2_208_988_800

/** Transmit timestamp from an NTP/SNTP response, as Unix milliseconds. */
export function ntpTimeFromPacket(packet: Buffer): number {
  if (packet.length < 48) throw new Error('NTP response is too short')
  const seconds = packet.readUInt32BE(40)
  const fraction = packet.readUInt32BE(44)
  return (seconds - NTP_UNIX_OFFSET) * 1000 + Math.round((fraction * 1000) / 2 ** 32)
}

/** Asks an NTP server for the current time. */
export function readNtpTime(host = process.env.NTP_SERVER || 'pool.ntp.org'): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    const packet = Buffer.alloc(48)
    packet[0] = 0x1b
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (err?: Error, time?: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (err) reject(err)
      else resolve(time as number)
    }
    timer = setTimeout(() => finish(new Error('NTP request timed out')), 3000)
    socket.once('error', (err) => finish(err))
    socket.once('message', (msg) => {
      try {
        finish(undefined, ntpTimeFromPacket(msg))
      } catch (err) {
        finish(err instanceof Error ? err : new Error('NTP response is unreadable'))
      }
    })
    socket.send(packet, 123, host, (err) => {
      if (err) finish(err)
    })
  })
}

/** Compares the server clock with an NTP reference and alerts instance admins when drift exceeds 1 second. */
export function startClockDriftSchedule(opts: {
  now?: () => number
  ntp?: () => Promise<number>
  poll?: boolean
} = {}) {
  const now = opts.now ?? (() => Date.now())
  const ntp = opts.ntp ?? (() => readNtpTime())
  const tick = async () => {
    const at = now()
    const check = checkClockDrift(await ntp(), at)
    const alert = generateClockDriftAlert(check)
    if (!alert) return false
    const admins = await listInstanceAdmins()
    const day = new Date(at).toISOString().slice(0, 10)
    await emitNotification({
      id: `clock-drift:${day}`,
      category: 'security',
      title: 'Clock drift',
      summary: alert.message,
      audience: 'personal',
      recipients: admins.map((admin) => ({ iss: admin.iss, sub: admin.sub })),
      createdAt: new Date(at).toISOString(),
    })
    return true
  }
  const safe = () => {
    void tick().catch((err) => console.error('[mice-auth] clock drift alert failed', err))
  }
  const timer = opts.poll === false ? undefined : setInterval(safe, pollMs)
  timer?.unref()
  if (opts.poll !== false) safe()
  return { tick, stop: () => clearInterval(timer) }
}
