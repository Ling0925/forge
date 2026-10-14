export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

// A small tolerance permits normal rounding and a reader just above the tail.
export function isNearTranscriptTail(metrics: ScrollMetrics): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= 64;
}

export class TranscriptScrollState {
  following = true;
  hasNewContent = false;

  reset() {
    this.following = true;
    this.hasNewContent = false;
  }

  readPosition(metrics: ScrollMetrics) {
    this.following = isNearTranscriptTail(metrics);
    if (this.following) this.hasNewContent = false;
  }

  contentArrived() {
    if (!this.following) this.hasNewContent = true;
    return this.following;
  }

  inspectDisclosure() {
    // Expanding evidence is reader interaction, not arriving chat content.
    this.following = false;
  }
}
