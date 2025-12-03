<script lang="ts">
  import type { SdkImageContent } from "$lib/stores/sdkSessions";
  import {
    getImagesFromClipboard,
    getImagesFromDrop,
    processImages,
    createPreviewUrl,
    formatFileSize,
    type ImageData,
  } from "$lib/utils/image";

  let {
    isQuerying = false,
    isRecording = false,
    isRecordingForCurrentSession = false,
    onSendPrompt,
    onStopQuery,
    onStartRecording,
    onStopRecording,
  }: {
    isQuerying?: boolean;
    isRecording?: boolean;
    isRecordingForCurrentSession?: boolean;
    onSendPrompt: (prompt: string, images?: SdkImageContent[]) => void;
    onStopQuery: () => void;
    onStartRecording: () => void;
    onStopRecording: () => void;
  } = $props();

  let prompt = $state("");
  let pendingImages = $state<ImageData[]>([]);
  let isProcessingImages = $state(false);
  let textareaEl: HTMLTextAreaElement;

  async function handleSendPrompt() {
    if (!prompt.trim() && pendingImages.length === 0) return;

    const currentPrompt = prompt;
    const currentImages =
      pendingImages.length > 0 ? [...pendingImages] : undefined;

    const imageContent: SdkImageContent[] | undefined = currentImages?.map(
      (img) => ({
        mediaType: img.mediaType,
        base64Data: img.base64Data,
        width: img.width,
        height: img.height,
      })
    );

    prompt = "";
    pendingImages = [];
    onSendPrompt(currentPrompt, imageContent);
  }

  async function handlePaste(e: ClipboardEvent) {
    const imageFiles = await getImagesFromClipboard(e);
    if (imageFiles.length > 0) {
      e.preventDefault();
      await addImages(imageFiles);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    const imageFiles = getImagesFromDrop(e);
    if (imageFiles.length > 0) {
      await addImages(imageFiles);
    }
  }

  async function addImages(files: File[]) {
    if (isProcessingImages) return;
    isProcessingImages = true;
    try {
      const processed = await processImages(files);
      pendingImages = [...pendingImages, ...processed];
    } catch (err) {
      console.error("[SdkPromptInput] Error processing images:", err);
    } finally {
      isProcessingImages = false;
    }
  }

  function removeImage(index: number) {
    pendingImages = pendingImages.filter((_, i) => i !== index);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendPrompt();
    }
  }

  function autoResize() {
    if (textareaEl) {
      textareaEl.style.height = "auto";
      const maxHeight = 200;
      const newHeight = Math.min(textareaEl.scrollHeight, maxHeight);
      textareaEl.style.height = newHeight + "px";
      textareaEl.style.overflowY =
        textareaEl.scrollHeight > maxHeight ? "auto" : "hidden";
    }
  }

  $effect(() => {
    prompt;
    autoResize();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="input-area" ondragover={handleDragOver} ondrop={handleDrop}>
  {#if pendingImages.length > 0 || isProcessingImages}
    <div class="pending-images">
      {#each pendingImages as img, i}
        <div class="pending-image">
          <img src={createPreviewUrl(img)} alt="Pending" />
          <button
            class="remove-image"
            onclick={() => removeImage(i)}
            title="Remove image"
          >
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path
                fill-rule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
          <span class="image-size">{formatFileSize(img.compressedSize)}</span>
        </div>
      {/each}
      {#if isProcessingImages}
        <div class="pending-image processing">
          <div class="processing-spinner"></div>
        </div>
      {/if}
    </div>
  {/if}
  <textarea
    bind:this={textareaEl}
    bind:value={prompt}
    oninput={autoResize}
    onkeydown={handleKeydown}
    onpaste={handlePaste}
    placeholder={pendingImages.length > 0
      ? "Add a message about the image(s)... (Enter to send)"
      : "Enter your prompt... (Ctrl+V to paste images, Enter to send)"}
    rows="1"
  ></textarea>
  <div class="button-group">
    {#if isQuerying}
      <button
        onclick={onStopQuery}
        class="stop-button"
        title="Stop current query"
      >
        <svg class="stop-icon" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>
    {/if}
    {#if isRecording && isRecordingForCurrentSession}
      <button
        class="record-button recording"
        onclick={onStopRecording}
        title="Stop recording and send"
      >
        <div class="recording-pulse"></div>
        <svg class="mic-icon" fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
            clip-rule="evenodd"
          />
        </svg>
      </button>
    {:else if !isRecording}
      <button
        class="record-button"
        onclick={onStartRecording}
        title="Record voice prompt"
      >
        <svg class="mic-icon" fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
            clip-rule="evenodd"
          />
        </svg>
      </button>
    {/if}
    <button
      onclick={handleSendPrompt}
      disabled={!prompt.trim() && pendingImages.length === 0}
      title={isQuerying ? "Send and interrupt" : "Send"}
    >
      Send
    </button>
  </div>
</div>

<style>
  .input-area {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    padding: 1rem;
    border-top: 1px solid var(--color-border);
    background: var(--color-background);
    position: relative;
  }

  textarea {
    flex: 1;
    background: var(--color-surface);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 0.75rem;
    resize: none;
    font-family: inherit;
    font-size: 0.9rem;
    line-height: 1.4;
    min-height: unset;
    max-height: 200px;
    overflow-y: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  textarea::-webkit-scrollbar {
    display: none;
  }

  textarea:focus {
    outline: none;
    border-color: var(--color-accent);
  }

  textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  textarea::placeholder {
    color: var(--color-text-muted);
  }

  .button-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  button {
    background: var(--color-accent);
    color: var(--color-background);
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.5rem;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    min-width: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  button:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .stop-button {
    background: var(--color-error);
    padding: 0.75rem;
    min-width: unset;
  }

  .stop-button:hover {
    background: color-mix(in srgb, var(--color-error) 80%, black);
  }

  .stop-icon {
    width: 16px;
    height: 16px;
  }

  .record-button {
    background: var(--color-surface-elevated);
    color: var(--color-text-secondary);
    border: none;
    border-radius: 6px;
    padding: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    min-width: unset;
  }

  .record-button:hover {
    background: var(--color-border);
    color: var(--color-text-primary);
  }

  .record-button.recording {
    background: var(--color-recording);
    color: var(--color-background);
  }

  .record-button.recording:hover {
    background: color-mix(in srgb, var(--color-recording) 80%, black);
  }

  .mic-icon {
    width: 18px;
    height: 18px;
    position: relative;
    z-index: 1;
  }

  .recording-pulse {
    position: absolute;
    inset: 0;
    background: var(--color-recording);
    border-radius: 6px;
    animation: pulse-recording 1.5s ease-in-out infinite;
  }

  @keyframes pulse-recording {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.7;
      transform: scale(1.05);
    }
  }

  /* Pending images preview */
  .pending-images {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-bottom: none;
    border-radius: 6px 6px 0 0;
  }

  .pending-image {
    position: relative;
    width: 80px;
    height: 80px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--color-surface-elevated);
  }

  .pending-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .pending-image .remove-image {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 20px;
    height: 20px;
    min-width: unset;
    padding: 2px;
    background: rgba(0, 0, 0, 0.7);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .pending-image:hover .remove-image {
    opacity: 1;
  }

  .pending-image .remove-image svg {
    width: 12px;
    height: 12px;
    color: #fff;
  }

  .pending-image .remove-image:hover {
    background: color-mix(in srgb, var(--color-error) 90%, transparent);
  }

  .pending-image .image-size {
    position: absolute;
    bottom: 2px;
    left: 2px;
    font-size: 0.65rem;
    color: #fff;
    background: rgba(0, 0, 0, 0.7);
    padding: 1px 4px;
    border-radius: 2px;
  }

  .pending-image.processing {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .processing-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Adjust textarea when images are present */
  .input-area:has(.pending-images) textarea {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
    border-top: none;
  }

  /* Drag and drop indicator */
  .input-area.drag-over::before {
    content: "Drop images here";
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    border: 2px dashed var(--color-accent);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-accent);
    font-weight: 500;
    z-index: 10;
  }
</style>
