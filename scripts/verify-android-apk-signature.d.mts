export type ParsedApksignerOutput = { signerCount: number; sha256: string }
export type ApksignerExecutionResult = {
  status: number | null
  stdout: string | null
  stderr: string | null
  error?: Error | null
}
export function parseApksignerOutput(output: string): ParsedApksignerOutput
export function assertApksignerOutputMatches(output: string, expectedSha256: string): ParsedApksignerOutput
export function verifyApksignerResult(result: ApksignerExecutionResult, expectedSha256: string): ParsedApksignerOutput

