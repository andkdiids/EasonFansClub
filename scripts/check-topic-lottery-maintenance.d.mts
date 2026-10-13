export const lotteryPhases: string[]

export function checkLotteryMaintenance(args: {
  previousRoot: string
  candidateRoot: string
  deploySha: string
  expectedSha: string
  approvalFile?: string
  now?: number
}): number
