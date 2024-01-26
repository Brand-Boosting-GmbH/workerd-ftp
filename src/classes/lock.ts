// structure that implements a basic queue sequence through promises
export default class Lock {
  private inUse = false;

  private queue: Array<() => void> = [];

  public lock(): Promise<void> {
    if (this.inUse) {
      return new Promise<void>((resolve) => {
        this.queue.push(() => {
          this.inUse = true
          resolve()
        })
      })
    } else {
      this.inUse = true
      return new Promise<void>((resolve) => resolve())
    }
  }

  public unlock() {
    this.inUse = false
    this.queue.shift()?.call(this)
  }
}
