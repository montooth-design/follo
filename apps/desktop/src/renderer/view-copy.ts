/** Edit top-level view headings and subheadings here; layout lives in each view component.
 * Navigation labels are defined separately in App.tsx. Repository names come from disk.
 * Card headings and button labels stay beside the component that renders them.
 */
export const VIEW_COPY = {
  Overview: {
    heading: 'follo your code.',
    subheading: 'Open a local repo and let follo help you follow what it does.',
  },
  Repositories: {
    heading: 'Repositories',
    subheading: 'Open a local repo and follow it through',
  },
  'Code Maps': {
    heading: 'Code Maps',
    subheading: 'Explore relationships established by source code.',
  },
  Search: {
    heading: 'Search',
    subheading: 'Find entry points into unfamiliar code.',
  },
  Ask: {
    heading: 'Ask',
    subheading: 'Investigate verified evidence with optional AI.',
  },
  Settings: {
    heading: 'Settings',
    subheading: 'Make this workspace your own.',
  },
} as const;
