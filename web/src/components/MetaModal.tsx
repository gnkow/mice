import { Modal } from './Modal'
import { MetaBody } from './MetaPanel'
import type { MetaTarget } from '../lib/meta'

export function MetaModal({ type, id, title, onClose, context, scope }: MetaTarget & { title: string; onClose: () => void; context?: NonNullable<MetaTarget['scope']> }) {
  return (
    <Modal title={title} onClose={onClose} wide>
      <MetaBody type={type} id={id} context={context} scope={scope} />
    </Modal>
  )
}
