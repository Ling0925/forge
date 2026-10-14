/** A completion may publish only while its owner and request generation survive. */
export class OperationScope {
  private generation = 0;
  private active = true;

  begin(): () => boolean {
    const generation = ++this.generation;
    return () => this.active && generation === this.generation;
  }

  close(): void {
    this.active = false;
    this.generation++;
  }
}
