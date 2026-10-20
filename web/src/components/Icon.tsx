import type { LucideProps } from 'lucide-react'
import * as LucideIcons from 'lucide-react'

export type IconName = keyof typeof LucideIcons

type IconProps = LucideProps & {
  name: IconName
}

/**
 * Centralized icon component using Lucide icons.
 * All icons are open-source (ISC License) and consistent.
 * 
 * @example
 * <Icon name="Download" size={16} />
 * <Icon name="Star" size={14} className="text-yellow-500" />
 * <Icon name="GitBranch" size={16} strokeWidth={2} />
 */
export function Icon({ name, size = 16, ...props }: IconProps) {
  const IconComponent = LucideIcons[name]
  
  if (!IconComponent) {
    console.warn(`Icon "${name}" not found in lucide-react`)
    return null
  }
  
  return <IconComponent size={size} {...props} />
}
