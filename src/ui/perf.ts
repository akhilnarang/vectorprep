/** Timing marks, exposed as window.__perf for the end-to-end tests. */
export const perf: { marks: Record<string, unknown>; detailRenders: number } = { marks: {}, detailRenders: 0 };
(window as unknown as { __perf: typeof perf }).__perf = perf;
