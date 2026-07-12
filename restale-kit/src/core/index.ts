export interface InvalidateSignal {
  key: unknown[];
  exact?: boolean;
  action?: 'invalidate' | 'refetch' | 'remove';
}
