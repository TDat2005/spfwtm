/** Mặc định: job chạy quá 10 phút thì coi tiến trình worker đã đơ. */
export const DEFAULT_STUCK_AFTER_MS = 10 * 60 * 1000;

/**
 * Chạy `work` và canh thời gian. Quá `stuckAfterMs` mà chưa xong thì gọi
 * `onStuck` (một lần); `null` nghĩa là không canh (job quét cả shop, có thể dài).
 *
 * Vì sao cần: khi một thao tác native (Sharp/libvips, fs, DNS) bị kẹt, event
 * loop vẫn chạy nên BullMQ vẫn gia hạn lock đều đặn. Job không bao giờ bị coi
 * là "stalled" và không worker nào nhận lại, dù nó sẽ không bao giờ xong.
 */
export async function runWithWatchdog<T>(
  work: () => Promise<T>,
  stuckAfterMs: number | null,
  onStuck: () => void,
): Promise<T> {
  if (stuckAfterMs === null) return work();
  const timer = setTimeout(onStuck, stuckAfterMs);
  // Bộ đếm không giữ tiến trình sống khi mọi việc khác đã xong.
  timer.unref?.();
  try {
    return await work();
  } finally {
    clearTimeout(timer);
  }
}
