import { get } from "svelte/store";
import { settings, VOICE_COMMAND_PRESETS } from "$lib/stores/settings";

export interface VoiceCommandResult {
  /** The cleaned transcript with voice commands removed */
  cleanedTranscript: string;
  /** Whether a voice command was detected */
  commandDetected: boolean;
  /** The command that was detected (if any) */
  detectedCommand: string | null;
  /** Whether the command should trigger sending the prompt */
  shouldSend: boolean;
}

/**
 * Check if voice commands are enabled in settings
 */
export function isVoiceCommandsEnabled(): boolean {
  const currentSettings = get(settings);
  return currentSettings.audio.voice_commands.enabled;
}

/**
 * Get the list of active voice commands
 */
export function getActiveVoiceCommands(): string[] {
  const currentSettings = get(settings);
  return currentSettings.audio.voice_commands.active_commands;
}

/**
 * Process a transcript to detect and remove voice commands.
 * Voice commands are detected at the end of the transcript (case-insensitive).
 *
 * @param transcript - The raw transcript text
 * @returns VoiceCommandResult with cleaned transcript and detection info
 */
export function processVoiceCommand(transcript: string): VoiceCommandResult {
  const result: VoiceCommandResult = {
    cleanedTranscript: transcript,
    commandDetected: false,
    detectedCommand: null,
    shouldSend: false,
  };

  // If voice commands are disabled, return original transcript
  if (!isVoiceCommandsEnabled()) {
    return result;
  }

  const activeCommands = getActiveVoiceCommands();
  if (activeCommands.length === 0) {
    return result;
  }

  // Normalize the transcript for comparison
  const trimmedTranscript = transcript.trim();
  const lowerTranscript = trimmedTranscript.toLowerCase();

  // Check each active command (longest first to avoid partial matches)
  const sortedCommands = [...activeCommands].sort(
    (a, b) => b.length - a.length
  );

  for (const command of sortedCommands) {
    const lowerCommand = command.toLowerCase();

    // Check if transcript ends with the command
    if (lowerTranscript.endsWith(lowerCommand)) {
      // Remove the command from the end
      const commandStartIndex = trimmedTranscript.length - command.length;
      let cleanedTranscript = trimmedTranscript.slice(0, commandStartIndex);

      // Clean up trailing punctuation and whitespace
      cleanedTranscript = cleanedTranscript.replace(/[\s,.!?;:]+$/, "").trim();

      result.cleanedTranscript = cleanedTranscript;
      result.commandDetected = true;
      result.detectedCommand = command;
      result.shouldSend = true;
      break;
    }

    // Also check with common punctuation/spacing variations
    const punctuationVariants = [
      `. ${lowerCommand}`,
      `, ${lowerCommand}`,
      `! ${lowerCommand}`,
      `? ${lowerCommand}`,
      `; ${lowerCommand}`,
      `: ${lowerCommand}`,
      ` - ${lowerCommand}`,
    ];

    for (const variant of punctuationVariants) {
      if (lowerTranscript.endsWith(variant)) {
        const variantStartIndex = trimmedTranscript.length - variant.length;
        let cleanedTranscript = trimmedTranscript.slice(0, variantStartIndex);
        cleanedTranscript = cleanedTranscript.replace(/[\s,.!?;:]+$/, "").trim();

        result.cleanedTranscript = cleanedTranscript;
        result.commandDetected = true;
        result.detectedCommand = command;
        result.shouldSend = true;
        break;
      }
    }

    if (result.commandDetected) break;
  }

  return result;
}

/**
 * Strip voice commands from a transcript without checking if enabled.
 * Useful for cleaning up transcripts regardless of settings.
 *
 * @param transcript - The raw transcript text
 * @param commands - List of commands to strip
 * @returns The cleaned transcript
 */
export function stripVoiceCommands(
  transcript: string,
  commands: string[]
): string {
  if (commands.length === 0) {
    return transcript;
  }

  const trimmedTranscript = transcript.trim();
  const lowerTranscript = trimmedTranscript.toLowerCase();

  // Check each command (longest first)
  const sortedCommands = [...commands].sort((a, b) => b.length - a.length);

  for (const command of sortedCommands) {
    const lowerCommand = command.toLowerCase();

    // Check if transcript ends with the command
    if (lowerTranscript.endsWith(lowerCommand)) {
      const commandStartIndex = trimmedTranscript.length - command.length;
      let cleanedTranscript = trimmedTranscript.slice(0, commandStartIndex);
      cleanedTranscript = cleanedTranscript.replace(/[\s,.!?;:]+$/, "").trim();
      return cleanedTranscript;
    }

    // Also check with common punctuation/spacing variations
    const punctuationVariants = [
      `. ${lowerCommand}`,
      `, ${lowerCommand}`,
      `! ${lowerCommand}`,
      `? ${lowerCommand}`,
      `; ${lowerCommand}`,
      `: ${lowerCommand}`,
      ` - ${lowerCommand}`,
    ];

    for (const variant of punctuationVariants) {
      if (lowerTranscript.endsWith(variant)) {
        const variantStartIndex = trimmedTranscript.length - variant.length;
        let cleanedTranscript = trimmedTranscript.slice(0, variantStartIndex);
        cleanedTranscript = cleanedTranscript.replace(/[\s,.!?;:]+$/, "").trim();
        return cleanedTranscript;
      }
    }
  }

  return trimmedTranscript;
}

/**
 * Get all available voice command presets
 */
export function getVoiceCommandPresets(): readonly string[] {
  return VOICE_COMMAND_PRESETS;
}

/**
 * Check if a custom command is valid (not empty, reasonable length)
 */
export function isValidVoiceCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed.length >= 2 && trimmed.length <= 30;
}
