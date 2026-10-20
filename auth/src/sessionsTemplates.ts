import { env } from './env.js'
import type { SessionTemplate } from './sessionsTypes.js'

const defaults = {
  cpu: env.sessionsDefaultCpu,
  memory: env.sessionsDefaultMemory,
  disk: env.sessionsDefaultDisk,
}

/** Built-in catalog (Phase 2). Override image via SESSIONS_DESKTOP_IMAGE. */
export function listSessionTemplates(): SessionTemplate[] {
  const localImage = env.sessionsDesktopImage
  return [
    {
      id: 'linux-xfce',
      name: 'Linux XFCE desktop',
      description:
        'Full Linux desktop (XFCE) with xrdp — local Docker provisioner',
      image: localImage,
      provisioner: 'docker',
      default_resources: { ...defaults },
    },
    {
      id: 'linux-mate',
      name: 'Linux MATE desktop',
      description: 'Alternate Linux desktop template (same local image by default)',
      image: localImage,
      provisioner: 'docker',
      default_resources: { ...defaults },
    },
  ]
}

export function getSessionTemplate(id: string): SessionTemplate | null {
  return listSessionTemplates().find((t) => t.id === id) ?? null
}
