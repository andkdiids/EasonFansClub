type Environment = Record<string, string | undefined>

function envBoolean(env: Environment, key: string) {
  return env[key]?.trim().toLowerCase() === 'true'
}

/**
 * Pronunciation assessment is an optional, explicitly enabled integration.
 * Keeping this disabled by default lets the local recording flow work without
 * Azure credentials or an outbound provider request.
 */
export function isCantonesePronunciationAssessmentEnabled(env: Environment = process.env) {
  return envBoolean(env, 'CANTONESE_PRONUNCIATION_ASSESSMENT_ENABLED')
}
