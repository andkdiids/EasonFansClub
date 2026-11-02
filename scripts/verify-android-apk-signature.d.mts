export type ParsedApksignerOutput = { signerCount: number; sha256: string }
export function parseApksignerOutput(output: string): ParsedApksignerOutput
export function assertApksignerOutputMatches(output: string, expectedSha256: string): ParsedApksignerOutput
