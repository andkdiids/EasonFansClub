import { randomBytes } from 'node:crypto'
import { MATERIAL_REDEMPTION_CODE_PREFIX } from '@/lib/material-redemption-domain'

export function generateMaterialRedeemCode() {
  return `${MATERIAL_REDEMPTION_CODE_PREFIX}${randomBytes(6).toString('hex').toUpperCase()}`
}
