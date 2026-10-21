/** Full-page navigation, behind one seam so tests can observe it. */
export const navigation = {
  go(url: string): void {
    window.location.assign(url);
  },
};
