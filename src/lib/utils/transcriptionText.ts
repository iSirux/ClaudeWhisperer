/**
 * Whether a transcription contains something a user could meaningfully submit.
 *
 * Speech engines sometimes report silence/very short clips as punctuation-only
 * strings such as ".". Those are successful API responses, but they must be
 * treated like an empty transcription so another configured engine can take over.
 */
export function hasMeaningfulTranscription(text: string | null | undefined): boolean {
  return typeof text === 'string' && /[\p{L}\p{N}]/u.test(text);
}
